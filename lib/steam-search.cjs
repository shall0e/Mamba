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
function compactTitle(raw) { return titleKey(raw).replace(/[^a-z0-9]/g, ''); }
function titleSimilarity(left, right) {
  const a=compactTitle(left),b=compactTitle(right);
  if(!a||!b)return 0;
  if(a===b)return 1;
  // Compare compact spellings as well as title words. This tolerates punctuation
  // and spacing changes while keeping sequel numbers significant.
  const aw=new Set(titleKey(left).split(' ')),bw=new Set(titleKey(right).split(' '));
  const overlap=[...aw].filter(word=>bw.has(word)).length;
  const dice=2*overlap/(aw.size+bw.size||1);
  const shorter=Math.min(a.length,b.length),longer=Math.max(a.length,b.length);
  const prefix=a.startsWith(b)||b.startsWith(a) ? shorter/longer : 0;
  return Math.max(dice,prefix);
}
function sourceMatches(source,app) {
  const wanted=titleKey(app.name),actual=titleKey(source.name);
  const sourceYear=source.name.match(/\(\s*((?:19|20)\d{2})\s*\)/)?.[1];
  const steamYear=app.name.match(/\(\s*((?:19|20)\d{2})\s*\)/)?.[1]||String(app.releaseDate||'').match(/\b((?:19|20)\d{2})\b/)?.[1];
  if(sourceYear&&steamYear&&sourceYear!==steamYear)return false;
  if(compactTitle(source.name)===compactTitle(app.name))return true;
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
    const words=query.split(/\s+/).filter(Boolean);
    const relaxedQuery=words.length>1?words.filter(word=>!/^\d{1,4}$/.test(word)).join(' '):'';
    const [candidates,sourceLists]=await Promise.all([this.steamResults(query),Promise.all([query,relaxedQuery].filter(Boolean).map(term=>Promise.resolve(this.catalog.search(term,0).items||[])))]);
    const sourceResults=[...new Map(sourceLists.flat().map(item=>[compactTitle(item.name),item])).values()];
    const apps=new Map();
    const directTask=(async()=>{let index=0;await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{while(index<candidates.length){const candidate=candidates[index++];const app=await this.identity.details(candidate.id).catch(()=>null);if(app?.type==='game')apps.set(String(app.steamId),app);}}));})();
    const directNames=new Set(candidates.map(candidate=>compactTitle(candidate.name)));
    const sourceCandidates=this.identity.identify?[...new Map(sourceResults.filter(item=>!directNames.has(compactTitle(item.name))).map(item=>[compactTitle(item.name),item])).values()].slice(0,40):[];
    const sourceTask=(async()=>{let index=0;await Promise.all(Array.from({length:Math.min(8,sourceCandidates.length)},async()=>{while(index<sourceCandidates.length){const item=sourceCandidates[index++];const identity=await this.identity.identify(item.name).catch(()=>null);if(!identity?.verified||identity.type!=='game'||!identity.steamId)continue;const app=await this.identity.details(identity.steamId).catch(()=>identity);if(app?.type==='game')apps.set(String(app.steamId),app);}}));})();
    await Promise.all([directTask,sourceTask]);
    const matched=[...apps.values()].map(candidate=>({candidate,releases:this.catalog.games.filter(source=>sourceMatches(source,candidate))})).filter(entry=>entry.releases.length);
    // Never attach a source to two Steam games when the title is ambiguous.
    const claims=new Map();for(const entry of matched)for(const source of entry.releases)claims.set(source.id,(claims.get(source.id)||0)+1);
    for(const [id,count]of claims)if(count>1)this.ambiguous.add(id);
    const results=new Array(matched.length);let next=0;
    await Promise.all(Array.from({length:Math.min(4,matched.length)},async()=>{while(next<matched.length){const index=next++,entry=matched[index];const app=entry.candidate;
      const releases=entry.releases.filter(source=>claims.get(source.id)===1&&sourceMatches(source,app));
      if(!releases.length)continue;
      this.apps.set('steam:'+app.steamId,app);results[index]=this.group(app,releases);if(results[index])this.groups.set(results[index].id,{games:this.catalog.games,ambiguous:this.ambiguous.size,group:results[index]});
    }}));
    await this.identity.save().catch(()=>{});
    // Compare normalized titles pairwise as well as against the query. A small
    // consensus boost groups a family of related releases without merging them.
    const discovered=results.filter(Boolean);
    const consensus=game=>discovered.length<2?0:discovered.reduce((sum,other)=>sum+(other===game?0:titleSimilarity(game.name,other.name)),0)/(discovered.length-1);
    const relevance=game=>titleSimilarity(query,game.name)+consensus(game)*.15;
    const games=discovered.sort((a,b)=>relevance(b)-relevance(a)||a.name.localeCompare(b.name)),start=Math.max(0,Number(offset)||0);
    return {total:games.length,items:games.slice(start,start+40)};
  }
}
module.exports={SteamSearch,titleKey,compactTitle,titleSimilarity,sourceMatches};
