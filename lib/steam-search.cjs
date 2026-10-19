const fs=require('node:fs/promises');
const path=require('node:path');
const {gameTitle,tokens,createSearchIndex,optionTraits}=require('./search.cjs');
const {atomicJson}=require('./catalog.cjs');

function titleKey(raw) {
  const cleaned=gameTitle(String(raw).replace(/[._]+/g,' ')).replace(/[’']/g,'');
  let words=tokens(cleaned.replace(/([a-z])(\d)/gi,'$1 $2')).map(word=>word==='v'?'5':word);
  const aliases={cod:['call','of','duty'],gta:['grand','theft','auto'],rdr:['red','dead','redemption']};
  if(Object.hasOwn(aliases,words[0]))words=[...aliases[words[0]],...words.slice(1)];
  return words.join(' ');
}
function sourceMatches(source,app) {
  const wanted=titleKey(app.name),actual=titleKey(source.name);
  const sourceYear=source.name.match(/\(\s*((?:19|20)\d{2})\s*\)/)?.[1];
  const steamYear=app.name.match(/\(\s*((?:19|20)\d{2})\s*\)/)?.[1];
  if(sourceYear&&steamYear&&sourceYear!==steamYear)return false;
  if(actual===wanted)return true;
  // Steam omits the original "4" from the remaster's official title.
  return wanted==='call of duty modern warfare remastered'&&actual==='call of duty 4 modern warfare remastered';
}
class SteamSearch {
  constructor(directory,catalog,identity,transport=fetch){
    this.file=path.join(directory,'steam-search.json');this.catalog=catalog;this.identity=identity;this.fetch=transport;
    this.groups=new Map();this.ambiguous=new Set();this.queries=new Map();this.apps=new Map();this.pending=new Map();this.writes=Promise.resolve();
  }
  async load(){try{this.queries=new Map(JSON.parse(await fs.readFile(this.file,'utf8')));}catch{}}
  async save(){this.writes=this.writes.catch(()=>{}).then(()=>atomicJson(this.file,[...this.queries].slice(-50)));await this.writes;}
  async steamResults(query){
    const key=query.trim().toLowerCase(),saved=this.queries.get(key);
    if(saved&&Date.now()-saved.at<15*60000)return saved.items;
    if(this.pending.has(key))return this.pending.get(key);
    const request=(async()=>{
      try{
        const url=new URL('https://store.steampowered.com/api/storesearch/');url.searchParams.set('term',query);url.searchParams.set('l','english');url.searchParams.set('cc','CA');
        const response=await this.fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Steam search is unavailable. Try again shortly.');
        const data=await response.json();if(!Array.isArray(data.items))throw Error('Steam returned an unreadable search result.');
        const unique=new Map();for(const item of data.items)if(Number.isSafeInteger(item.id)&&item.id>0&&typeof item.name==='string'&&(!item.type||item.type==='app'))unique.set(item.id,item);
        const items=[...unique.values()];this.queries.set(key,{at:Date.now(),items});while(this.queries.size>50)this.queries.delete(this.queries.keys().next().value);await this.save().catch(()=>{});return items;
      }catch(error){if(saved&&Date.now()-saved.at<7*86400000)return saved.items;throw error;}
    })();this.pending.set(key,request);try{return await request;}finally{this.pending.delete(key);}
  }
  group(app,releases){
    if(!releases.length)return null;
    const combined=createSearchIndex(releases.map(release=>({...release,name:app.name})));const group=combined[0];if(!group)return null;
    // Keep the exact original release labels and IDs for downloading/ranking.
    const byId=this.catalog.byId;
    group.options=group.options.map(option=>({...option,release:byId.get(option.gameId)?.name||option.release}));
    if(!group.options.some(option=>{const traits=optionTraits(option);return !traits.partial&&!traits.incompatible;}))return null;
    return {...group,id:'steam:'+app.steamId,steamId:app.steamId,name:app.name,cover:app.cover,verified:true};
  }
  forApp(app){
    if(!app||app.type!=='game'||!app.steamId||!app.cover)return null;
    this.apps.set('steam:'+app.steamId,app);
    const releases=this.catalog.games.filter(source=>!this.ambiguous.has(source.id)&&sourceMatches(source,app));
    return this.group(app,releases);
  }
  get(id){const saved=this.groups.get(id);if(saved&&saved.games===this.catalog.games&&saved.ambiguous===this.ambiguous.size)return saved.group;const app=this.apps.get(id);const group=app?this.forApp(app):null;if(group)this.groups.set(id,{games:this.catalog.games,ambiguous:this.ambiguous.size,group});return group;}
  async search(query,offset=0){
    query=String(query||'').trim().slice(0,300);if(!query)return {total:0,items:[]};
    const candidates=await this.steamResults(query);
    const matched=candidates.map(candidate=>({candidate,releases:this.catalog.games.filter(source=>sourceMatches(source,candidate))})).filter(entry=>entry.releases.length);
    // Never attach a source to two Steam games when the title is ambiguous.
    const claims=new Map();for(const entry of matched)for(const source of entry.releases)claims.set(source.id,(claims.get(source.id)||0)+1);
    for(const [id,count]of claims)if(count>1)this.ambiguous.add(id);
    let next=0;const results=new Array(matched.length);
    await Promise.all(Array.from({length:Math.min(4,matched.length)},async()=>{while(next<matched.length){const index=next++,entry=matched[index];const app=await this.identity.details(entry.candidate.id).catch(()=>null);if(app?.type!=='game')continue;
      const releases=entry.releases.filter(source=>claims.get(source.id)===1&&sourceMatches(source,app));
      if(!releases.length)continue;
      this.apps.set('steam:'+app.steamId,app);results[index]=this.group(app,releases);if(results[index])this.groups.set(results[index].id,{games:this.catalog.games,ambiguous:this.ambiguous.size,group:results[index]});
    }}));
    await this.identity.save().catch(()=>{});
    const games=results.filter(Boolean),start=Math.max(0,Number(offset)||0);
    return {total:games.length,items:games.slice(start,start+40)};
  }
}
module.exports={SteamSearch,titleKey,sourceMatches};
