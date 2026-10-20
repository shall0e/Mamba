const { TorBox, torrentHash } = require('./torbox.cjs');
const path = require('node:path');
const SERVICES = ['torbox', 'realdebrid', 'direct'];
const enabledServices = config => (config.enabledDownloadServices || ['torbox', 'direct']).filter(id => SERVICES.includes(id));
function hostKey(uri) { if(torrentHash(uri))return 'torrent';try{return new URL(uri).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';} }
function hostAllowed(uri, config) {return !(config.disabledDownloadHosts || []).includes(hostKey(uri));}
function directKind(uri) {
  try {const url=new URL(uri);if(url.protocol!=='https:'||url.username||url.password)return null;
    if(url.hostname==='pixeldrain.com'&&/^\/(?:u|l)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))return 'pixeldrain';
    if(/\.(?:zip|rar|7z|exe|bin|\d{3})$/i.test(url.pathname))return 'https';
  }catch{}return null;
}
function candidates(link, config, rdHosts=[]) {
  if(!hostAllowed(link.uri,config))return [];
  const enabled=enabledServices(config), list=[];
  if(enabled.includes('direct')&&directKind(link.uri))list.push('direct');
  if(enabled.includes('realdebrid')&&config.realDebridApiKey&&(torrentHash(link.uri)||rdHosts.some(host=>hostKey(link.uri)===host||hostKey(link.uri).endsWith('.'+host))))list.push('realdebrid');
  return list;
}
function chooseService(link,config,requested) {
  const services=(link.services||['torbox',...(directKind(link.uri)?['direct']:[])]).filter(id=>enabledServices(config).includes(id)&&(id!=='torbox'||config.torboxApiKey)&&(id!=='realdebrid'||config.realDebridApiKey));
  if(!hostAllowed(link.uri,config))throw Error('This download host is disabled in Settings.');
  const selected=requested&&requested!=='auto'?requested:(services.includes(config.preferredDownloadService)?config.preferredDownloadService:services[0]);
  if(!selected||!services.includes(selected))throw Error('Enable a compatible download service in Settings.');
  return selected;
}
async function json(response,label) {const data=await response.json().catch(()=>null);if(!response.ok||!data||data.success===false)throw Error(`${label} request failed (${response.status}).`);return data;}
class DirectDownloads {
  constructor(transport=fetch){this.fetch=transport;this.files=[];}
  async create(uri,_cached,signal){if(!directKind(uri))throw Error('This link needs a supported download service.');this.uri=uri;return {kind:'direct',id:uri.includes('pixeldrain.com/')?new URL(uri).pathname.slice(1):'file'};}
  async info(_kind,id,signal){
    if(id.startsWith('u/')||id.startsWith('l/')){
      const [type,key]=id.split('/');const data=await json(await this.fetch(`https://pixeldrain.com/api/${type==='l'?'list/'+key:'file/'+key+'/info'}`,{signal}),'Pixeldrain');
      this.files=(type==='l'?data.files:[data]).map(file=>{if(file.availability)throw Error('Pixeldrain: '+(file.availability_message||'File unavailable.'));return {id:file.id,name:file.name,size:Number(file.size),url:`https://pixeldrain.com/api/file/${encodeURIComponent(file.id)}?download`};});
    }else{
      let response=await this.fetch(this.uri,{method:'HEAD',signal});
      let total=Number(response.headers.get('content-length'));
      if(!response.ok||!total){response=await this.fetch(this.uri,{headers:{Range:'bytes=0-0','Accept-Encoding':'identity'},signal});total=response.status===206?Number(response.headers.get('content-range')?.split('/')[1]):Number(response.headers.get('content-length'));}
      await response.body?.cancel().catch(()=>{});
      if(!response.ok||/text\/html|application\/(?:json|xhtml)/i.test(response.headers.get('content-type')||''))throw Error('The source returned a webpage instead of a downloadable file.');
      const name=decodeURIComponent(path.posix.basename(new URL(this.uri).pathname));this.files=[{id:0,name,size:total||0,url:this.uri}];
    }
    if(!this.files.length||this.files.some(file=>!Number.isSafeInteger(file.size)||file.size<0||!file.name))throw Error('The download service returned invalid file information.');
    return {download_finished:true,files:this.files};
  }
  async downloadLink(_kind,_id,fileId){const file=this.files.find(file=>String(file.id)===String(fileId));if(!file)throw Error('Download file is unavailable.');return file.url;}
}
class RealDebrid {
  constructor(key,transport=fetch,uri){this.key=key;this.fetch=transport;this.uri=uri;this.ready=null;}
  async request(route,body,signal){const response=await this.fetch('https://api.real-debrid.com/rest/1.0/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+this.key},...(body?{body:new URLSearchParams(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});if(response.status===204)return null;return json(response,'Real-Debrid');}
  async hosts(signal){const result=await this.request('hosts/domains',null,signal);return Array.isArray(result)?result:[];}
  async create(uri,_cached,signal){this.uri=uri;if(torrentHash(uri)){const result=await this.request('torrents/addMagnet',{magnet:uri},signal);if(!result.id)throw Error('Real-Debrid did not return a transfer ID.');return {kind:'torrents',id:result.id};}return {kind:'webdl',id:'web'};}
  async info(kind,id,signal){
    if(kind==='webdl'){this.ready=await this.request('unrestrict/link',{link:this.uri},signal);return {download_finished:true,files:[{id:0,name:this.ready.filename,size:this.ready.filesize}]};}
    const data=await this.request('torrents/info/'+encodeURIComponent(id),null,signal);
    if(data.status==='waiting_files_selection'){await this.request('torrents/selectFiles/'+encodeURIComponent(id),{files:'all'},signal);return {download_state:'Selecting files',progress:0};}
    if(/error|virus|dead/.test(data.status))throw Error('Real-Debrid could not prepare this release ('+data.status+').');
    this.ready=data;
    const files=(data.files||[]).filter(file=>file.selected===1).map(file=>({id:file.id,name:String(file.path).replace(/^\//,''),size:file.bytes}));
    if(data.status==='downloaded'&&files.length!==(data.links||[]).length)throw Error('Real-Debrid returned a split download. Choose another release.');
    return {download_finished:data.status==='downloaded',progress:(data.progress||0)/100,download_state:data.status,files};
  }
  async downloadLink(kind,_id,fileId,signal){let result=this.ready;if(kind==='torrents'){const selected=this.ready.files.filter(file=>file.selected===1);const index=selected.findIndex(file=>String(file.id)===String(fileId));if(index<0||!this.ready.links[index])throw Error('Real-Debrid download file is unavailable.');result=await this.request('unrestrict/link',{link:this.ready.links[index]},signal);}if(!result?.download||new URL(result.download).protocol!=='https:')throw Error('Real-Debrid did not return a secure download URL.');return result.download;}
}
function createService(id,config,transport,uri){if(id==='direct'){const service=new DirectDownloads(transport);service.uri=uri;return service;}if(id==='realdebrid')return new RealDebrid(config.realDebridApiKey,transport,uri);return new TorBox(config.torboxApiKey,transport);}
module.exports={SERVICES,enabledServices,hostKey,hostAllowed,directKind,candidates,chooseService,createService,DirectDownloads,RealDebrid};
