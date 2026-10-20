(function(root){
  const nameKey=name=>String(name||'').replace(/[™®©]/g,'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const steamId=game=>String(game.steamId||game.identity?.steamId||(/^steam:/.test(game.id||'')?game.id.slice(6):''));
  function installed(games,game){const matches=games.filter(item=>{const a=steamId(item),b=steamId(game);return a&&b?a===b:!!nameKey(game.name)&&nameKey(item.name)===nameKey(game.name);});return matches.find(item=>item.status==='installed'&&item.executable)||matches[0]||null;}
  function download(jobs,game){const ids=new Set([game.id,...(game.options||[]).map(option=>option.gameId)]);return jobs.find(job=>job.status!=='cancelled'&&(ids.has(job.gameId)||nameKey(job.name)===nameKey(game.name)))||null;}
  const api={nameKey,installed,download};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MambaPresence=api;
})(typeof window==='undefined'?globalThis:window);
