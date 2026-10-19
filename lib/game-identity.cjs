const fs=require('node:fs/promises');const path=require('node:path');const {tokens,displayTitle}=require('./search.cjs');
function cleanTitle(raw){
 return displayTitle(String(raw).replace(/[._]+/g,' ').replace(/\bbuild\s*\d.*$/i,'').replace(/\b(?:windows|win64|win32|x64|x86)\b/gi,'').replace(/\bearly access\b/gi,''))
 .replace(/\s+(?:v\s*\d+(?:[. ]\d+)*|\d{2}[.]\d{2}[.]\d{4}).*$/i,'').replace(/\s*\+\s*(?:all\s+)?dlcs?\b.*$/i,'')
 .replace(/\s+(?:(?:digital\s+)?deluxe|ultimate|complete|gold|goty)(?:\s+edition)?\b/gi,'').replace(/\(\s*\)/g,'').replace(/[+\s,:–—-]+$/,'').replace(/\s+/g,' ').trim();
}
function identityWords(name){return tokens(cleanTitle(name).replace(/[’']/g,'').replace(/([a-z])(\d)/gi,'$1 $2')).map(w=>w==='v'?'5':w);}
function matchesTitle(raw,candidate){
 const wanted=identityWords(raw),actual=identityWords(candidate);
 if(wanted.join(' ')===actual.join(' '))return true;
 if(wanted.length>1&&/^[a-z]{2,5}$/.test(wanted[0])){
  for(let n=2;n<=5&&n<=actual.length;n++)if(actual.slice(0,n).map(w=>w[0]).join('')===wanted[0]&&wanted.slice(1).join(' ')===actual.slice(n).join(' '))return true;
 }
 return false;
}
class GameIdentity{
 constructor(directory,transport=fetch){this.file=path.join(directory,'game-identities.json');this.fetch=transport;this.cache=new Map();this.pending=new Map();this.writes=Promise.resolve();}
 async load(){try{this.cache=new Map(JSON.parse(await fs.readFile(this.file,'utf8')));}catch{}}
 async save(){this.writes=this.writes.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.tmp',JSON.stringify([...this.cache]));await fs.rename(this.file+'.tmp',this.file);});await this.writes;}
 async details(id){
  if(!Number.isSafeInteger(Number(id))||Number(id)<=0)return null;
  const key='app:'+id,saved=this.cache.get(key);if(saved&&Date.now()-saved.at<30*86400000)return saved.data;
  const response=await this.fetch('https://store.steampowered.com/api/appdetails?appids='+id+'&l=english&cc=CA',{signal:AbortSignal.timeout(7000)});if(!response.ok)return null;
  const result=(await response.json())[String(id)];if(!result?.success||!result.data?.name)return null;
  const app=result.data;const data={steamId:Number(id),name:app.name,type:app.type,cover:app.header_image||`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,parentId:Number(app.fullgame?.appid)||null,dlcIds:app.dlc||[]};
  this.cache.set(key,{at:Date.now(),data});return data;
 }
 identify(raw,{aliases=[]}={}){
  const key='title:'+identityWords(raw).join(' ')+'|'+aliases.map(a=>identityWords(a).join(' ')).join('|');if(this.pending.has(key))return this.pending.get(key);
  const task=this.identifyNow(raw,key,aliases);this.pending.set(key,task);task.finally(()=>this.pending.delete(key)).catch(()=>{});return task;
 }
 async identifyNow(raw,key,aliases){
  const fallback={name:cleanTitle(raw)||raw,verified:false,type:'unknown'};const saved=this.cache.get(key);
  if(saved&&Date.now()-saved.at<(saved.data.verified?30:0.05)*86400000)return saved.data;
  try{
   let candidates=[];
   const names=[raw,...aliases.filter(name=>cleanTitle(name).length>=5)];
   const queries=[cleanTitle(raw)];if(/^[A-Z]{2,5}\s/.test(raw))queries.push(cleanTitle(raw).split(' ').slice(1).join(' '));queries.push(...aliases.map(cleanTitle).filter(name=>name.length>=5));
   for(const query of [...new Set(queries)].slice(0,4)){
    const url=new URL('https://store.steampowered.com/api/storesearch/');url.searchParams.set('term',query);url.searchParams.set('l','english');url.searchParams.set('cc','CA');
    const response=await this.fetch(url,{signal:AbortSignal.timeout(7000)});if(!response.ok)continue;
    const items=(await response.json()).items||[];
    candidates=items.filter(item=>Number.isSafeInteger(item.id)&&names.some(name=>matchesTitle(name,item.name)));
    if(!candidates.length&&identityWords(raw).length===1&&identityWords(raw)[0].length>=5){const word=identityWords(raw)[0];candidates=items.filter(item=>identityWords(item.name)[0]===word);}
    if(candidates.length)break;
   }
   if(candidates.length!==1){this.cache.set(key,{at:Date.now(),data:fallback});return fallback;}
   const app=await this.details(candidates[0].id);if(!app||!['game','dlc','demo'].includes(app.type))return fallback;
   let baseGame=null;if(app.type!=='game'&&app.parentId){baseGame=await this.details(app.parentId);if(baseGame?.type!=='game')baseGame=null;}
   const data={...app,verified:true,baseGame};this.cache.set(key,{at:Date.now(),data});await this.save();return data;
  }catch{return fallback;}
 }
}
function versionParts(name){const match=String(name).match(/\bbuild[ ._-]*(\d+)/i)||String(name).match(/\bv[ .]?(\d+(?:\.\d+)*)/i);return match?match[1].split('.').map(Number):[];}
function primaryOrder(a,b){
 const playable=Number(b.status==='installed'&&!!b.executable)-Number(a.status==='installed'&&!!a.executable);if(playable)return playable;
 const av=versionParts(a.sourceName),bv=versionParts(b.sourceName);for(let i=0;i<Math.max(av.length,bv.length);i++)if((bv[i]||0)!==(av[i]||0))return (bv[i]||0)-(av[i]||0);return a.folder.localeCompare(b.folder);
}
async function groupInstallations(items,identify){
 let next=0;const enriched=new Array(items.length);
 await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(next<items.length){const i=next++,item=items[i];const aliases=item.executable?path.relative(item.folder,item.executable).split(path.sep).slice(0,-1).filter(name=>! /^(?:bin|binaries|x64|win64|engine|data)$/i.test(name)):[];const info=await identify(item.name,{aliases}).catch(()=>({name:cleanTitle(item.name),verified:false}));enriched[i]={...item,sourceName:item.name,name:info.name||cleanTitle(item.name),identity:info};}}));
 const groups=new Map();
 for(const item of enriched){const base=item.identity.baseGame||item.identity;const key=base.steamId?'steam:'+base.steamId:identityWords(item.name).join(' ');if(!groups.has(key))groups.set(key,{base,items:[]});groups.get(key).items.push(item);}
 const result=[];
 for(const {base,items:members}of groups.values()){
  const installs=members.filter(item=>!['dlc','demo'].includes(item.identity.type)).sort(primaryOrder);
  const dlcs=members.filter(item=>item.identity.type==='dlc'&&item.identity.baseGame);const demos=members.filter(item=>item.identity.type==='demo'&&item.identity.baseGame);
  const primary=installs[0]||{...members[0],executable:null,installer:null,status:'base-missing'};
  result.push({...primary,name:base.name||primary.name,steamId:base.steamId||null,verified:members.some(item=>item.identity.verified),cover:base.cover||null,installations:installs,dlcs:dlcs.map(item=>({id:item.id,name:item.name,steamId:item.identity.steamId,folder:item.folder})),demos:demos.map(item=>({id:item.id,name:item.name,folder:item.folder})),availableDlcCount:base.dlcIds?.length||0});
 }
 return {items:result.sort((a,b)=>a.name.localeCompare(b.name)),installations:enriched};
}
module.exports={GameIdentity,cleanTitle,matchesTitle,groupInstallations};
