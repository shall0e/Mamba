(() => {
  const $ = selector => document.querySelector(selector);
  let currentDetail = null, generation = 0, favoritesOnly = false, sort = 'name', activity = null;
  let recentJobs = [], openIssues = 0, currentPage = 'search';
  const node = (tag, text, className) => { const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element; };
  function handleError(error) {
    const text=String(error?.message||error||'This task could not finish.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    showToast(text+' · See Activity for help');
    window.mamba.reportIssue(text).catch(()=>{});return true;
  }
  function action(label,callback,iconName,className) {return button(label,callback,iconName,className);}
  function cover(container,id,name) {
    container.append($('#library-empty svg').cloneNode(true));
    window.mamba.artwork(id).then(image=>{
      if(!image||!container.isConnected)return;
      const img=node('img');img.src=image;img.alt=name+' artwork';img.decoding='async';img.loading='lazy';
      img.onload=()=>container.classList.add('has-cover');img.onerror=()=>img.remove();container.append(img);
    }).catch(()=>{});
  }
  function date(value) {return value?new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Not played yet';}
  async function refreshLibrary(){renderLibrary(await window.mamba.library());}
  async function toggleFavorite(game) {await window.mamba.favorite(game.id,!game.favorite);}
  function renderLibrary(games) {
    installedGames=Array.isArray(games)?games.filter(game=>game&&typeof game.name==='string'):[];
    const query=$('#library-filter').value.trim().toLowerCase();
    const matches=installedGames.filter(game=>(!favoritesOnly||game.favorite)&&[game.name,...(game.installations||[]).map(item=>item.sourceName||item.name),...(game.dlcs||[]).map(item=>item.name)].join(' ').toLowerCase().includes(query));
    matches.sort((a,b)=>sort==='recent'?(b.lastPlayed||'').localeCompare(a.lastPlayed||'')||a.name.localeCompare(b.name):sort==='installed'?(b.installedAt||'').localeCompare(a.installedAt||'')||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
    $('#library-empty').hidden=installedGames.length>0;$('#library-toolbar').hidden=!installedGames.length;
    $('#filter-empty').hidden=matches.length>0||!installedGames.length;$('#game-count').textContent=installedGames.length+' '+(installedGames.length===1?'game':'games');
    const list=$('#game-list');list.replaceChildren();
    for(const game of matches){
      const card=node('li',undefined,'game-card');
      const image=action('',()=>openGame(game,'library'),null,'game-art library-cover');image.setAttribute('aria-label','View '+game.name);cover(image,game.id,game.name);
      const favorite=action('',()=>toggleFavorite(game),'star','favorite-button'+(game.favorite?' is-favorite':''));favorite.setAttribute('aria-label',(game.favorite?'Unfavorite ':'Favorite ')+game.name);favorite.setAttribute('aria-pressed',String(!!game.favorite));favorite.title=favorite.getAttribute('aria-label');
      const heading=node('h2',game.name);const status=node('p',game.repairPending?'Folder cleanup pending':game.status==='installed'?'Ready to play':game.status==='base-missing'?'Base game not installed':'Review installation');
      const detail=node('p',game.lastPlayed?'Last played '+date(game.lastPlayed):game.verified?'Matched with Steam':'Local installation','game-secondary');
      const controls=node('div',undefined,'game-actions');
      if(game.status==='installed'&&game.executable)controls.append(action('Play',()=>window.mamba.gameAction(game.id,'play'),'play','primary-button'));
      else controls.append(action('Review',()=>openGame(game,'library'),'settings-2','primary-button'));
      controls.append(action('Details',()=>openGame(game,'library'),'info'));
      card.append(image,favorite,heading,status,detail,controls);
      if((game.installations?.length||0)>1||game.dlcs?.length)card.append(node('p',[game.installations?.length>1?game.installations.length+' installations':'',game.dlcs?.length?game.dlcs.length+' DLC':''].filter(Boolean).join(' · '),'game-secondary'));
      list.append(card);
    }
  }
  async function openGame(game,origin) {
    const token=++generation;currentDetail=null;
    window.MambaExperience.origin=origin||(!$('#library-page').hidden?'library':'search');
    const content=$('#game-content');content.replaceChildren();
    content.append(action('Back to '+(window.MambaExperience.origin==='library'?'library':'search'),()=>{generation++;showPage(window.MambaExperience.origin);},'arrow-left'));
    const title=node('h1',game.name||'Game details');title.id='game-title';title.tabIndex=-1;content.append(title);
    const loading=node('p','Loading game details…','field-hint');loading.setAttribute('role','status');content.append(loading);showPage('game');
    try {
      const data=await window.mamba.details(game.id);if(token!==generation)return;currentDetail=data;loading.remove();title.remove();
      const hero=node('div',undefined,'detail-hero');const image=node('div',undefined,'detail-art game-art');cover(image,data.libraryId||data.catalogId||data.id,data.name);
      const intro=node('div',undefined,'detail-intro');const heading=node('h1',data.name);heading.id='game-title';heading.tabIndex=-1;
      intro.append(node('p',data.steamId?'STEAM GAME':'YOUR GAME','page-eyebrow'),heading);
      intro.append(node('p',[data.developers.join(', '),data.releaseDate,...data.genres].filter(Boolean).join(' · '),'page-description'));
      const primary=node('div',undefined,'detail-primary');
      const playable=data.installations.find(item=>item.status==='installed'&&item.executable);
      if(playable)primary.append(action('Play',()=>window.mamba.gameAction(playable.id,'play'),'play','primary-button'));
      if(data.catalogId)primary.append(action(playable?'Download another version':'Download best match',async()=>{await window.mamba.downloadBest(data.catalogId);showToast('Added to downloads');showPage('activity');},'download',playable?'secondary-button':'primary-button'));
      if(data.libraryId){const favorite=action(data.favorite?'Favorited':'Favorite',async()=>{await window.mamba.favorite(data.libraryId,!data.favorite);data.favorite=!data.favorite;favorite.lastChild.textContent=data.favorite?'Favorited':'Favorite';favorite.setAttribute('aria-pressed',String(data.favorite));},'star');favorite.setAttribute('aria-pressed',String(data.favorite));primary.append(favorite);}
      intro.append(primary);if(data.lastPlayed)intro.append(node('p','Last played '+date(data.lastPlayed),'field-hint'));
      hero.append(image,intro);content.append(hero);
      content.append(node('p',data.description||'A description is not available. Your installation and download options are shown below.','game-description'));
      if(data.installations.length){
        const section=node('section',undefined,'detail-section');section.append(node('h2','Your installations'),node('p','Review the detected folder and startup file. You can change the launcher at any time.','field-hint'));
        for(const installation of data.installations){
          const card=node('article',undefined,'installation-card');
          card.append(node('h3',installation.version?'Version '+installation.version:installation.sourceName||data.name));
          card.append(node('p',installation.status==='installed'?'Ready to play':'Setup or launcher review required','installation-status'));
          const details=node('dl',undefined,'installation-fields');
          for(const [label,value]of [['Game folder',installation.folder],['Startup file',installation.executable||'No launcher selected'],['Installed version',installation.version||'Not reported by this release'],['Added',installation.installedAt?date(installation.installedAt):'Existing installation']])details.append(node('dt',label),node('dd',value));
          card.append(details);const controls=node('div',undefined,'game-actions');
          if(installation.status==='installed'&&installation.executable)controls.append(action('Play',()=>window.mamba.gameAction(installation.id,'play'),'play','primary-button'));
          if(installation.installer)controls.append(action('Run setup',()=>window.mamba.gameAction(installation.id,'setup'),'play'));
          controls.append(action('Change launcher',async()=>{const result=await window.mamba.chooseLauncher(installation.id);if(result){await refreshLibrary();await openGame({id:data.libraryId||data.id,name:data.name},'library');showToast('Startup file saved');}},'folder-open'));
          controls.append(action('Open folder',()=>window.mamba.gameAction(installation.id,'folder'),'folder-open'));
          controls.append(action('Setup helper',()=>window.mamba.gameAction(installation.id,'launcher'),'settings-2'));
          controls.append(action(installation.imported?'Remove from library':'Uninstall',async()=>{const result=await window.mamba.removeGame(installation.id);if(result){await refreshLibrary();showPage('library');showToast(installation.imported?'Removed from library; files kept':'Installation moved to Recycle Bin');}},'trash-2','text-button danger-action'));
          card.append(controls);section.append(card);
        }content.append(section);
      }
      if(data.dlcs.length||data.demos.length||data.availableDlcCount){const section=node('section',undefined,'detail-section');section.append(node('h2','Additional content'));for(const item of [...data.dlcs,...data.demos]){const row=node('div',undefined,'content-item');row.append(node('p',item.name),action('Open folder',()=>window.mamba.gameAction(item.id,'folder'),'folder-open'));section.append(row);}section.append(node('p',data.dlcs.length+' installed DLC folders detected'+(data.availableDlcCount?' · '+data.availableDlcCount+' DLC listed by Steam':''),'field-hint'));content.append(section);}
      if(data.catalogId){
        const section=node('section',undefined,'detail-section');section.append(node('h2','Download options'));
        const hint=node('p','Checking TorBox availability and your preferences…','field-hint');section.append(hint);content.append(section);
        if(data.space){const info=node('p',data.space.error||[data.space.free===null?'Free space unavailable':formatBytes(data.space.free)+' free',data.space.required?formatBytes(data.space.required)+' estimated for download and setup':'Size will be checked when TorBox prepares the files'].join(' · '),'storage-note');section.append(info);}
        try{
          const resolved=await window.mamba.resolveGame(data.catalogId);if(token!==generation)return;
          hint.textContent=resolved.best?'Recommended using availability, compatibility, language and release preferences.':resolved.message;
          const renderOption=(option,best)=>{
            const card=node('article',undefined,'download-choice'+(best?' recommended-choice':''));if(best)card.append(node('p','RECOMMENDED FOR YOU','choice-label'));
            card.append(node('h3',option.release),node('p',[option.fileSize,option.sources.join(', ')].filter(Boolean).join(' · '),'choice-meta'),node('p',option.reasons.join(' · '),'choice-reasons'));
            const download=action(best?'Download best match':'Download this version',async()=>{await window.mamba.download(option.gameId,option.linkIndex);showToast('Added to downloads');showPage('activity');},'download',best?'primary-button':'secondary-button');download.disabled=!option.available||option.traits.incompatible||option.traits.partial;card.append(download);return card;
          };
          if(resolved.best)section.append(renderOption(resolved.best,true));
          const alternatives=resolved.options.filter(option=>!resolved.best||option.gameId!==resolved.best.gameId||option.linkIndex!==resolved.best.linkIndex);
          if(alternatives.length){const details=node('details',undefined,'other-downloads');const summary=node('summary','All other versions ('+alternatives.length+')');summary.append(icon('chevron-down'));details.append(summary);alternatives.forEach(option=>details.append(renderOption(option,false)));section.append(details);}
        }catch(error){hint.textContent='Download options could not be checked. '+String(error.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');section.append(action('Try again',()=>openGame({id:data.id,name:data.name},window.MambaExperience.origin),'refresh-cw'),action('Open settings',openSettings,'settings-2'));}
      }
    }catch(error){if(token!==generation)return;loading.textContent='Game details could not be loaded.';content.append(node('p',String(error.message),'field-hint'),action('Try again',()=>openGame(game,window.MambaExperience.origin),'refresh-cw'),action('Troubleshoot',()=>showPage('activity'),'circle-alert'));}
  }
  function renderIssues(items=[]) {
    const open=items.filter(issue=>!issue.resolved);openIssues=open.length;updateActivityBadge();$('#issue-count').textContent=open.length+' open';const list=$('#issues-list');list.replaceChildren();
    if(!open.length)list.append(node('p','No unresolved issues.','field-hint'));
    for(const issue of open){const card=node('article',undefined,'issue-card');const heading=node('h3');heading.append(icon('circle-alert'),document.createTextNode(issue.title||'This task needs attention'));card.append(heading,node('p',issue.advice||'Try again.','issue-advice'));const detail=node('details',undefined,'issue-details');detail.append(node('summary','Details'),node('p',issue.message),node('p',date(issue.at)+(issue.count>1?' · Seen '+issue.count+' times':''),'field-hint'));card.append(detail);const controls=node('div',undefined,'game-actions');
      if(issue.action==='settings')controls.append(action('Open settings',openSettings,'settings-2'));
      if(issue.action==='library')controls.append(action('Review library',()=>showPage('library'),'folder-open'));
      if(['catalog:sync','catalog:search'].includes(issue.context))controls.append(action('Retry source sync',()=>window.mamba.sync(),'refresh-cw'));
      if(issue.context==='library:scan')controls.append(action('Refresh library',refreshLibrary,'refresh-cw'));
      controls.append(action('Mark resolved',()=>window.mamba.resolveIssue(issue.id),'check'));card.append(controls);list.append(card);
    }
  }
  async function loadActivity() {
    try{activity=await window.mamba.activity();const health=$('#system-health');health.replaceChildren();
      for(const [title,value,hint]of [['Background tasks',activity.worker.connected?'Connected':'Disconnected',activity.worker.pending+' requests in progress'],['Sources',activity.catalog.phase,activity.catalog.count.toLocaleString()+' checked releases · '+activity.catalog.unavailableSources+' sources unavailable'],['Library',activity.libraryCount+' games','Installed games on this PC']]){const card=node('article',undefined,'health-card');card.append(node('p',title,'field-hint'),node('h2',value),node('p',hint,'field-hint'));health.append(card);}
      $('#stop-sync').disabled=!['fetching','merging','checking','waiting'].includes(activity.catalog.phase);
      $('#restart-tasks').disabled=activity.jobs.some(job=>['extracting','installing'].includes(job.status));renderIssues(activity.issues);
    }catch(error){$('#system-health').replaceChildren(node('p','Status is unavailable. '+error.message,'field-hint'));}
  }
  function updateActivityBadge(){const active=recentJobs.filter(job=>!['completed','cancelled','needs-setup','failed','paused'].includes(job.status)).length;const count=active+openIssues;$('#activity-count').hidden=!count;$('#activity-count').textContent=count;$('#activity-count').title=active+' active downloads · '+openIssues+' issues';$('#activity-count').setAttribute('aria-label',count+' tasks or issues');}
  function jobsChanged(jobs) {
    recentJobs=jobs;const count=jobs.filter(job=>!['completed','cancelled','needs-setup','failed','paused'].includes(job.status)).length;
    updateActivityBadge();$('#activity-empty').hidden=jobs.length>0;
  }
  function pageChanged(name){currentPage=name;if(name==='activity')loadActivity();}
  const api={origin:'search',openGame,renderLibrary,jobsChanged,pageChanged,handleError,configure(config){sort=config.librarySort||'name';favoritesOnly=!!config.libraryFavoritesOnly;$('#library-sort').value=sort;$('#favorites-only').setAttribute('aria-pressed',String(favoritesOnly));renderLibrary(installedGames);}};
  window.MambaExperience=api;
  $('#activity-transfers').append($('#transfers'));
  const toolbar=$('#library-toolbar');const filters=node('div',undefined,'library-view-controls');
  const favoriteFilter=action('Favorites',()=>{favoritesOnly=!favoritesOnly;favoriteFilter.setAttribute('aria-pressed',String(favoritesOnly));renderLibrary(installedGames);window.mamba.saveView({libraryFavoritesOnly:favoritesOnly}).catch(handleError);},'star');favoriteFilter.id='favorites-only';favoriteFilter.setAttribute('aria-pressed','false');
  const sortSelect=node('select',undefined,'settings-input library-sort');sortSelect.id='library-sort';sortSelect.setAttribute('aria-label','Sort library');for(const [value,label]of [['name','Name A–Z'],['recent','Recently played'],['installed','Recently installed']]){const option=node('option',label);option.value=value;sortSelect.append(option);}sortSelect.onchange=()=>{sort=sortSelect.value;renderLibrary(installedGames);window.mamba.saveView({librarySort:sort}).catch(handleError);};filters.append(favoriteFilter,sortSelect);toolbar.append(filters);
  const bind=(id,callback,iconName)=>{const element=$(id);if(iconName)element.prepend(icon(iconName));element.addEventListener('click',async()=>{element.disabled=true;try{await callback();}catch(error){handleError(error);}finally{element.disabled=false;}});};
  bind('#activity-open',()=>showPage('activity'));bind('#open-troubleshooting',()=>showPage('activity'),'circle-alert');bind('#import-game',async()=>{const games=await window.mamba.importGame();if(games){renderLibrary(games);showToast('Existing game added');}},'folder-plus');
  bind('#refresh-activity',loadActivity,'refresh-cw');bind('#stop-sync',async()=>{await window.mamba.stopSync();await loadActivity();},'pause');bind('#restart-tasks',async()=>{if(await window.mamba.restartTasks()){showToast('Background tasks restarted');await loadActivity();}},'rotate-ccw');
  bind('#check-storage',async()=>{const space=await window.mamba.storage();$('#storage-status').textContent=space.free===null?'The folder is writable. Free space could not be read.':formatBytes(space.free)+' available in your Games folder. Each download is checked again before extraction.';},'folder-open');
  bind('#export-diagnostics',async()=>{if(await window.mamba.exportDiagnostics())showToast('Diagnostics exported without API keys, file paths or download links');},'download');
  window.mamba.jobs().then(renderJobs).catch(handleError);
  window.mamba.activity().then(status=>renderIssues(status.issues)).catch(()=>{});
  window.mamba.onIssues(renderIssues);window.mamba.onNotice(notice=>{showToast(notice.name+(notice.status==='completed'?' is ready to play':notice.status==='needs-setup'?' needs installation review':' needs attention — open Activity'));if(currentPage==='activity')loadActivity();});
  window.mamba.onNavigate(async target=>{if(target.page==='activity')return showPage('activity');const game=installedGames.find(item=>item.folder===target.folder);await openGame(game||{id:target.id,name:'Game details'},game?'library':'search');});
  window.addEventListener('error',event=>{if(event.message)handleError(new Error(event.message));});
  window.addEventListener('unhandledrejection',event=>{event.preventDefault();handleError(event.reason);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentPage==='activity')loadActivity();});
  setInterval(()=>{if(currentPage==='activity'&&!document.hidden)loadActivity();},5000);
})();
