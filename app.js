const backdrop = document.querySelector('#settings-backdrop');
const keyInput = document.querySelector('#api-key');
const sourceUrlsInput = document.querySelector('#source-urls');
const saveStatus = document.querySelector('#save-status');
const toast = document.querySelector('#toast');
let downloadPreferences = { downloadPath: '', autoInstall: true, cachedOnly: true, archivePassword: '', keepArchives:false, transferTimeoutMinutes:120, automaticUpdates:true, palette:{} };
let searchGeneration = 0;
let searchTimer;
let searchLayoutAnimation;
let searchOffset = 0;
let catalogState = {};
let detailGeneration = 0;
const cardJobs = new Map();
let featuredGameId = null;

let steamSlides = [];
let steamSlideIndex = -1;
let steamSlideBusy = false;
const reducedBackdropMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function thumbnailGlowColors(image) {
  try {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 20;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 20);
    const pixels = context.getImageData(0, 0, 32, 20).data;
    const bins = new Map();
    for (let index = 0; index < pixels.length; index += 4) {
      const rgb = [...pixels.slice(index, index + 3)];
      const max = Math.max(...rgb), min = Math.min(...rgb);
      if (max < 45 || min > 225 || max - min < 22) continue;
      const key = rgb.map(channel => channel >> 5).join(',');
      const bin = bins.get(key) || { rgb: [0, 0, 0], count: 0, weight: 0 };
      rgb.forEach((channel, i) => bin.rgb[i] += channel); bin.count++;
      bin.weight += .7 + ((max - min) / max) * .3;
      bins.set(key, bin);
    }
    const candidates = [...bins.values()].sort((a, b) => b.weight - a.weight).map(bin => bin.rgb.map(channel => channel / bin.count));
    const chosen = [];
    for (const rgb of candidates) {
      if (chosen.some(other => rgb.reduce((sum, value, i) => sum + (value - other[i]) ** 2, 0) < 5500)) continue;
      chosen.push(rgb);
      if (chosen.length === 3) break;
    }
    if (!chosen.length) return ['#c8c8c8', '#eeeeee', '#a8a8a8'];
    return Array.from({ length: 3 }, (_, i) => {
      const rgb = chosen[i % chosen.length];
      // Keep the sampled color soft; only lift very dim shades a little so
      // they remain visible against darkened Steam artwork.
      const factor = Math.min(1.16, 180 / Math.max(...rgb));
      return '#' + rgb.map(channel => Math.round(Math.min(255, channel * factor)).toString(16).padStart(2, '0')).join('');
    });
  } catch { return null; }
}

async function advanceSteamBackdrop() {
  const backdrop = document.querySelector('#steam-backdrop');
  if (!backdrop || !steamSlides.length || steamSlideBusy || document.hidden || !document.body.classList.contains('home-active')) return;
  if (reducedBackdropMotion.matches && backdrop.childElementCount) return;
  steamSlideBusy = true;
  try {
    for (let attempt = 0; attempt < steamSlides.length; attempt++) {
      steamSlideIndex = (steamSlideIndex + 1) % steamSlides.length;
      const game = steamSlides[steamSlideIndex];
      if (backdrop.lastElementChild?.dataset.appId === String(game.id)) return;
      const image = document.createElement('img');
      image.crossOrigin = 'anonymous';
      image.src = game.image;
      image.alt = '';
      image.decoding = 'async';
      image.dataset.appId = game.id;
      try { await image.decode(); } catch {
        image.removeAttribute('crossorigin'); image.src = game.image;
        try { await image.decode(); } catch { continue; }
      }
      if (document.hidden || !document.body.classList.contains('home-active')) return;
      const previous = [...backdrop.children];
      if(!previous.length)image.style.transitionDuration='900ms';
      const ambient = document.querySelector('#ambient-art');
      const previousGlow = [...ambient.children];
      const glow = document.createElement('span');
      thumbnailGlowColors(image)?.forEach((color, index) => glow.style.setProperty('--art-glow-' + index, color));
      backdrop.append(image);
      ambient.append(glow);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        image.classList.add('visible');
        glow.classList.add('visible');
      }));
      // Retain the previous slide until the incoming artwork has fully faded in.
      setTimeout(() => [...previous, ...previousGlow].forEach(slide => slide.remove()), 2800);
      return;
    }
  } finally { steamSlideBusy = false; }
}

async function loadSteamBackdrop() {
  if (!window.mamba?.featuredGames) return;
  try {
    const games = await window.mamba.featuredGames();
    if (!Array.isArray(games) || !games.length) return;
    steamSlides = games;
    steamSlideIndex = -1;
    await advanceSteamBackdrop();
  } catch { /* The search page remains usable when Steam artwork is offline. */ }
}
loadSteamBackdrop();
setInterval(advanceSteamBackdrop, 10000);
setInterval(loadSteamBackdrop, 30 * 60 * 1000);

function updateHomeBackdrop() {
  const home = !document.querySelector('#search-page').hidden && !document.querySelector('#main-search').value.trim();
  document.body.classList.toggle('home-active', home);
  if (home && !document.querySelector('#steam-backdrop').childElementCount) advanceSteamBackdrop();
  if (home) {
    const image = document.querySelector('#steam-backdrop img.visible');
  }
}


function titleMatchTokens(value) {
  const roman = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9' };
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[™®©]/g, '')
    .toLocaleLowerCase().replace(/\b(?:iii|ii|iv|viii|vii|vi|v|ix)\b/g, token => roman[token])
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function confidentTitleMatch(query, name) {
  const ignore = new Set(['a', 'an', 'and', 'of', 'the', 'for', 'on', 'edition', 'pc']);
  const wanted = titleMatchTokens(query).filter(word => !ignore.has(word));
  const title = titleMatchTokens(name).filter(word => !ignore.has(word));
  if (!wanted.length || !title.length) return 0;
  const normalize = words => [...new Set(words)].sort().join(' ');
  if (normalize(wanted) === normalize(title)) return 1;
  if (wanted.length === 1) return 0;
  const matches = wanted.filter(word => title.includes(word)).length;
  if (matches !== wanted.length) return 0;
  const queryPhrase = wanted.join(' ');
  const titlePhrase = title.join(' ');
  if (titlePhrase.includes(queryPhrase) && title.length - wanted.length <= 3) {
    return .82 + .17 * (wanted.length / title.length);
  }
  const overlap = matches / new Set([...wanted, ...title]).size;
  return overlap >= .76 ? overlap : 0;
}

function bestFeaturedMatch(query, games) {
  const ranked = games.map(game => ({ game, score: confidentTitleMatch(query, game.name) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  // Avoid guessing when a broad or shortened query matches several titles alike.
  if (ranked.length > 1 && ranked[0].score < 1 && ranked[0].score - ranked[1].score < .12) return null;
  return ranked[0].game;
}

function renderFeaturedGame(game) {
  const banner = document.querySelector('#featured-game');
  banner.replaceChildren();
  banner.hidden = !game;
  if (!game) return;
  banner.dataset.gameId = String(game.id);
  const cover = document.createElement('img'); cover.className = 'featured-art'; cover.alt = ''; cover.decoding = 'async';
  window.mamba.artwork(game.id).then(image => { if (image && banner.isConnected && banner.dataset.gameId === String(game.id)) cover.src = image; }).catch(() => {});
  cover.addEventListener('error', () => cover.remove());
  const shade = document.createElement('div'); shade.className = 'featured-shade';
  const content = document.createElement('div'); content.className = 'featured-content';
  const badge = document.createElement('p'); badge.className = 'featured-badge'; badge.textContent = 'Best match';
  const title = document.createElement('h2'); title.textContent = game.name;
  const actions = document.createElement('div'); actions.className = 'featured-actions';
  actions.append(button('Download', async () => {
    const jobId = await window.mamba.downloadBest(game.id);
    cardJobs.set(game.id, jobId); showToast(`${game.name} added to downloads`);
  }, 'download', 'primary-button'));
  actions.append(button('Details', () => openGame(game), 'info', 'secondary-button'));
  content.append(badge, title, actions);
  banner.append(cover, shade, content);
}

function icon(name) { return document.querySelector(`#icon-${name}`)?.content.cloneNode(true) || document.createDocumentFragment(); }
function button(label, action, iconName, className = 'text-button') {
  const control = document.createElement('button'); control.type = 'button'; control.className = className;
  if(iconName==='play')control.classList.add('play-button');
  if (iconName) control.append(icon(iconName));
  control.append(document.createTextNode(label));
  control.addEventListener('click', async (event) => {
    control.disabled = true;control.setAttribute('aria-busy','true');
    try { await action(event); } catch (error) { window.MambaExperience?.handleError(error) || showToast(error.message); } finally { control.removeAttribute('aria-busy');control.disabled = control.dataset.locked === 'true'; }
  });
  return control;
}
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
function remainingTime(job) {
  const speed = Number(job.speed), total = Number(job.total), received = Number(job.received);
  if (!(speed > 0) || !(total > 0)) return 'Estimating time…';
  const seconds = Math.ceil(Math.max(0, total - received) / speed);
  if (!seconds) return 'Finishing download…';
  if (seconds < 60) return `${seconds}s remaining`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m remaining`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}
function renderCatalog(state) {
  if (!state) return;
  const previousCount = catalogState.count;
  const previousPhase = catalogState.phase;
  catalogState = state;
  const text = state.message + (state.errors?.length ? ` · ${state.errors.length} sources unavailable` : '');
  document.querySelector('#catalog-status').textContent = text;
  document.querySelector('#settings-catalog-status').textContent = text;
  const errorList = document.querySelector('#source-errors'); errorList.replaceChildren(); errorList.hidden = !state.errors?.length;
  for (const error of state.errors || []) { const item = document.createElement('li'); item.textContent = `${error.source}: ${error.message}`; errorList.append(item); }
  document.querySelector('#sync-catalog').disabled = ['fetching', 'merging', 'checking'].includes(state.phase);
  document.querySelector('#settings-sync').disabled = document.querySelector('#sync-catalog').disabled;
  if (document.querySelector('#game-detail').hidden && document.querySelector('#main-search').value.trim() && (state.phase === 'ready' || previousCount !== state.count)) runSearch();
  if(state.phase==='ready'&&previousPhase!=='ready')window.MambaSettings?.loadHosts();
}
async function runSearch(more = false) {
  const query = document.querySelector('#main-search').value.trim();
  const generation = ++searchGeneration;
  detailGeneration++;
  document.querySelector('#game-detail').hidden = true;
  document.querySelector('#results-browse').hidden = false;
  const page = document.querySelector('#search-page');
  const content = page.querySelector('.search-content');
  const layoutChanged = page.classList.contains('has-results') !== Boolean(query);
  if (layoutChanged) {
    searchLayoutAnimation?.cancel();
    const before = content.getBoundingClientRect();
    page.classList.toggle('has-results', Boolean(query));
    const after = content.getBoundingClientRect();
    if (!reducedBackdropMotion.matches && !page.hidden) {
      searchLayoutAnimation = content.animate([
        { translate: `${before.x - after.x}px ${before.y - after.y}px` },
        { translate: '0 0' }
      ], { duration: 480, easing: 'cubic-bezier(.22, 1.08, .36, 1)' });
    }
  }
  document.querySelector('#search-results').hidden = !query;
  if (!query || !window.mamba) return;
  if (!more) { searchOffset = 0; featuredGameId = null; renderFeaturedGame(null); document.querySelector('#results-list').replaceChildren(); }
  document.querySelector('#results-status').textContent = 'Searching…';
  window.MambaDiscovery.start(more);
  try {
    const result = await window.mamba.search(query, searchOffset);
    if (generation !== searchGeneration) return;
    window.MambaDiscovery.update(result,more);
    searchOffset += result.items.length;
    document.querySelector('#results-more').hidden = searchOffset >= result.total;
  } catch (error) { if(generation!==searchGeneration)return;renderFeaturedGame(null); window.MambaDiscovery.fail(error.message); }
}
async function openGame(game) { return window.MambaExperience.openGame(game); }
function renderJobs(jobs) {
  window.MambaExperience?.jobsChanged(jobs);
  const jobIds = new Set(jobs.map((job) => job.id));
  for (const [gameId, jobId] of cardJobs) if (!jobIds.has(jobId)) cardJobs.delete(gameId);
  for (const control of document.querySelectorAll('button[data-job-id]')) {
    if (jobIds.has(control.dataset.jobId)) continue;
    delete control.dataset.jobId; control.dataset.locked = 'false'; control.disabled = false; control.lastChild.textContent = 'Download';
  }
  for (const job of jobs) {
    const controls = [...document.querySelectorAll('button[data-job-id]')].filter((control) => control.dataset.jobId === job.id);
    const failed = ['failed', 'cancelled'].includes(job.status);
    for (const control of controls) {
      control.lastChild.textContent = failed ? 'Download' : job.status === 'completed' ? 'Installed' : job.status === 'needs-setup' ? 'Setup required' : 'Queued';
      control.dataset.locked = String(!failed); control.disabled = !failed;
    }
    if (failed) for (const [gameId, jobId] of cardJobs) if (jobId === job.id) cardJobs.delete(gameId);
  }
  document.querySelector('#transfers').hidden = !jobs.length;
  document.querySelector('#transfer-count').textContent = `${jobs.filter((job) => !['completed', 'cancelled', 'needs-setup', 'failed', 'paused'].includes(job.status)).length} active`;
  const list = document.querySelector('#transfer-list');
  for (const row of list.children) if (!jobIds.has(row.id.slice('transfer-'.length))) row.remove();
  document.querySelector('#clear-finished').disabled = !jobs.some((job) => ['completed', 'needs-setup', 'cancelled', 'failed'].includes(job.status));
  for (const job of jobs) {
    let row = document.getElementById(`transfer-${job.id}`);
    if (!row) {
      row = document.createElement('article'); row.id = `transfer-${job.id}`; row.className = 'transfer-row';
      const name = document.createElement('h3'); name.textContent = job.name;
      const status = document.createElement('span'); status.className = 'transfer-status';
      const message = document.createElement('p'); message.className = 'transfer-message';
      const stats = document.createElement('div'); stats.className = 'transfer-stats';
      const bar = document.createElement('progress'); bar.max = 100; bar.setAttribute('aria-label', `Progress for ${job.name}`);
      const actions = document.createElement('div'); actions.className = 'transfer-actions';
      const stages=document.createElement('ol');stages.className='transfer-stages';stages.setAttribute('aria-label','Download stages');for(const label of ['Preparing','Downloading','Extracting','Installing','Ready']){const stage=document.createElement('li');stage.textContent=label;stages.append(stage);}
      row.append(name, status, stages, message, stats, bar, actions); list.append(row);
    }
    row.querySelector('.transfer-status').textContent = ({'needs-setup':'Needs setup',completed:'Ready',failed:'Needs attention',cancelled:'Cancelled'})[job.status] || job.status;
    row.querySelector('.transfer-message').textContent = job.error ? job.error.title + ' · ' + job.error.advice : ['downloading','completed'].includes(job.status) ? '' : job.message;
    const stats=row.querySelector('.transfer-stats');stats.replaceChildren();
    if(job.total>0){for(const text of [`${Math.min(100,Math.max(0,Math.floor((job.received||0)/job.total*100)))}%`,`${formatBytes(job.received)} / ${formatBytes(job.total)}`,...(job.status==='downloading'?[remainingTime(job)]:[])]){const value=document.createElement('span');value.textContent=text;stats.append(value);}}
    const current={queued:0,preparing:0,downloading:1,extracting:2,installing:3,completed:4,'needs-setup':3}[['paused','failed','cancelled'].includes(job.status)?job.stage:job.status];
    [...row.querySelectorAll('.transfer-stages li')].forEach((node,index)=>{node.classList.toggle('stage-done',current!==undefined&&index<current);node.classList.toggle('stage-current',index===current);node.setAttribute('aria-current',index===current?'step':'false');});
    row.querySelector('progress').value = job.progress || 0;
    row.querySelector('progress').hidden=['failed','cancelled','needs-setup'].includes(job.status);
    if(['preparing','extracting','installing'].includes(job.status))row.querySelector('progress').removeAttribute('value');
    const actions = row.querySelector('.transfer-actions');
    if (row.dataset.status !== job.status) {
      actions.replaceChildren(); row.dataset.status = job.status;
      if (['queued','preparing','downloading'].includes(job.status))actions.append(button('Pause',()=>window.mamba.pause(job.id),'pause'));
      if (['failed', 'cancelled', 'paused'].includes(job.status)) actions.append(button(job.status==='paused'?'Resume':'Retry', () => window.mamba.retry(job.id), 'rotate-ccw'));
      else if (!['completed', 'needs-setup'].includes(job.status)) actions.append(button('Cancel', () => window.mamba.cancel(job.id)));
      if(job.status==='failed')actions.append(button('Get help',()=>showPage('activity'),'circle-alert'));
      if(job.status==='completed'||job.status==='needs-setup')actions.append(button(job.status==='completed'?'View game':'Review installation',()=>openGame({id:job.gameId,name:job.name}),'arrow-right'));
      if(['completed','needs-setup','failed','paused','cancelled'].includes(job.status))actions.append(button('Remove', () => window.mamba.removeDownload(job.id), 'x'));
    }
  }
}
document.querySelector('#clear-finished').addEventListener('click', async () => {
  try { await window.mamba.clearFinished(); } catch (error) { window.MambaExperience?.handleError(error) || showToast(error.message); }
});

function showPage(name) {
  const pages = { search: '#search-page', library: '#library-page', settings: '#settings-backdrop',game:'#game-page',activity:'#activity-page' };
  if(!pages[name])return;
  for (const [page, selector] of Object.entries(pages)) {
    document.querySelector(selector).hidden = page !== name;
  }
  updateHomeBackdrop();
  document.querySelector(pages[name]).scrollTop = 0;
  document.querySelectorAll('[data-page]').forEach((button) => {
    const active = button.dataset.page === (name === 'game' ? window.MambaExperience?.origin || 'search' : name);
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (name !== 'settings') {
    keyInput.type = 'password';
    updateSettingsState();
  }
  const target = {search:'.main-input',library:'#library-title',settings:'#settings-title',game:'#game-title',activity:'#activity-title'}[name];
  document.querySelector(target)?.focus({ preventScroll: true });
  window.MambaExperience?.pageChanged(name);
}

function renderLibrary(games = installedGames) {
  if(window.MambaExperience)return window.MambaExperience.renderLibrary(games);
  installedGames = games.filter((game) => game && typeof game.name === 'string');
  const query = document.querySelector('#library-filter').value.trim().toLowerCase();
  const installed = installedGames.filter((game) => [game.name, ...(game.installations || []).map(item => item.sourceName || item.name), ...(game.dlcs || []).map(item => item.name)].join(' ').toLowerCase().includes(query));
  const list = document.querySelector('#game-list');
  list.replaceChildren();
  document.querySelector('#library-empty').hidden = installedGames.length > 0;
  document.querySelector('#library-toolbar').hidden = installedGames.length === 0;
  document.querySelector('#filter-empty').hidden = installed.length > 0 || installedGames.length === 0;
  document.querySelector('#game-count').textContent = `${installedGames.length} ${installedGames.length === 1 ? 'game' : 'games'}`;
  installed.forEach((game) => {
    const card = document.createElement('li');
    card.className = 'game-card';
    const mark = document.createElement('div');
    const source = document.querySelector('#library-empty svg');
    mark.append(source.cloneNode(true));
    mark.className = 'game-art';
    if (window.mamba && game.id) window.mamba.artwork(game.id).then(image => {
      if (!image || !mark.isConnected) return;
      const cover = document.createElement('img'); cover.src = image; cover.alt = game.name + ' cover'; cover.loading = 'lazy'; cover.decoding = 'async';
      cover.addEventListener('load', () => mark.classList.add('has-cover')); cover.addEventListener('error', () => cover.remove()); mark.append(cover);
    }).catch(() => {});

    const name = document.createElement('h2');
    name.textContent = game.name;
    const status = document.createElement('p');
    status.textContent = game.repairPending ? 'Folder cleanup pending' : game.status === 'base-missing' ? 'Base game not installed' : game.status === 'installed' ? 'Ready to play' : 'Setup required';
    card.append(mark, name, status);
    const identity = document.createElement('p'); identity.textContent = game.verified ? 'Verified on Steam' : 'Steam match unavailable'; card.append(identity);
    const alternatives = game.installations || [];
    if (alternatives.length > 1 || game.dlcs?.length || game.demos?.length) {
      const details = document.createElement('details'); details.className = 'game-editions';
      const summary = document.createElement('summary'); summary.textContent = [alternatives.length > 1 ? alternatives.length + ' installations' : '', game.dlcs?.length ? game.dlcs.length + ' DLC' : '', game.demos?.length ? game.demos.length + ' demos' : ''].filter(Boolean).join(' · '); details.append(summary);
      for (const item of alternatives.length > 1 ? alternatives : []) {
        const label = document.createElement('p'); label.textContent = item.sourceName || item.name; label.title = item.folder; details.append(label);
        const actions = document.createElement('div'); actions.className = 'game-actions';
        if (item.status === 'installed' && item.executable) actions.append(button('Play', () => window.mamba.gameAction(item.id, 'play'), 'play'));
        actions.append(button('Folder', () => window.mamba.gameAction(item.id, 'folder'), 'folder-open'));
        actions.append(button('Startup file', () => window.mamba.gameAction(item.id, 'launcher'), 'folder-open')); details.append(actions);
      }
      for (const item of [...(game.dlcs || []), ...(game.demos || [])]) {
        const label = document.createElement('p'); label.textContent = item.name; details.append(label);
        details.append(button('Folder', () => window.mamba.gameAction(item.id, 'folder'), 'folder-open'));
      }
      card.append(details);
    }
    if (window.mamba && game.id) {
      const actions = document.createElement('div'); actions.className = 'game-actions';
      if (game.status === 'installed' && game.executable) actions.append(button('Play', () => window.mamba.gameAction(game.id, 'play'), 'play', 'primary-button'));
      else if (game.installer) actions.append(button('Set up', () => window.mamba.gameAction(game.id, 'setup'), 'play', 'primary-button'));
      actions.append(button('Folder', () => window.mamba.gameAction(game.id, 'folder'), 'folder-open'));
      actions.append(button('Startup file', () => window.mamba.gameAction(game.id, 'launcher'), 'folder-open'));
      card.append(actions);
    }
    list.append(card);
  });
}

document.querySelector('#search-open').addEventListener('click', () => showPage('search'));
document.querySelector('#library-open').addEventListener('click', () => showPage('library'));
document.querySelector('#library-search').addEventListener('click', () => showPage('search'));
document.querySelector('#library-filter').addEventListener('input', () => renderLibrary());
document.querySelector('#clear-filter').addEventListener('click', () => {
  document.querySelector('#library-filter').value = '';
  renderLibrary();
  document.querySelector('#library-filter').focus();
});

if (window.windowControls) {
  const maximizeButton = document.querySelector('#window-maximize');
  const updateMaximized = (maximized) => {
    maximizeButton.classList.toggle('maximized', maximized);
    maximizeButton.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize');
    maximizeButton.title = maximized ? 'Restore window' : 'Maximize';
  };
  document.querySelector('#window-minimize').addEventListener('click', () => window.windowControls.minimize());
  maximizeButton.addEventListener('click', () => window.windowControls.toggleMaximize());
  document.querySelector('#window-close').addEventListener('click', () => window.windowControls.close());
  window.windowControls.onMaximized(updateMaximized);
  window.windowControls.isMaximized().then(updateMaximized);
}

const STORAGE_KEY = 'mamba-url-list-v1';
let urls = loadUrls();
let keyConfigured = false;
let toastTimer;
let configLoaded = false;
let settingsBusy = false;
let settingsSaveTimer;
let installedGames = [];
let settingsInitialized = false;

function sourceLines() {
  return sourceUrlsInput.value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function hasSettingsChanges() {
  return Boolean(keyInput.value.trim()) || !!window.MambaSettings?.hasKeyChange() || JSON.stringify([...new Set(sourceLines())]) !== JSON.stringify(urls) || JSON.stringify(Object.entries(readDownloadPreferences()).sort(([a],[b])=>a.localeCompare(b))) !== JSON.stringify(Object.entries(downloadPreferences).sort(([a],[b])=>a.localeCompare(b)));
}

function scheduleSettingsSave(delay = 500) {
  clearTimeout(settingsSaveTimer);
  updateSettingsState();
  if (!configLoaded) return;
  settingsSaveTimer = setTimeout(() => {
    if (hasSettingsChanges()) document.querySelector('#settings-form').requestSubmit();
  }, delay);
}

function updateSearchState() {
  updateHomeBackdrop();
  const populated = Boolean(document.querySelector('#main-search').value);
  document.querySelector('#search-clear').hidden = !populated;
  document.querySelector('#search-shortcut').hidden = populated;
  document.querySelector('#search-setup').hidden = !configLoaded || urls.length > 0;
}

function updateSettingsState() {
  window.MambaSettings?.busy(!configLoaded||settingsBusy);
  const visibility = document.querySelector('#key-visibility');
  visibility.classList.toggle('revealed', keyInput.type === 'text');
  visibility.setAttribute('aria-label', keyInput.type === 'text' ? 'Hide API key' : 'Show API key');
  visibility.title = visibility.getAttribute('aria-label');
  document.querySelector('#key-status').textContent = !configLoaded ? 'Loading…' : keyConfigured ? 'Key saved' : 'Not connected';
  document.querySelector('#key-status').classList.toggle('configured', keyConfigured);
  keyInput.placeholder = keyConfigured ? 'Saved · enter a new key to replace' : 'Paste your API key';
  const count = new Set(sourceLines()).size;
  const disabledSources=window.MambaSettings?.read().disabledSourceUrls||[];
  const activeSources=[...new Set(sourceLines())].filter(uri=>!disabledSources.includes(uri)).length;
  document.querySelector('#source-count').textContent = `${activeSources} of ${count} enabled`;
  for (const control of [keyInput, sourceUrlsInput, visibility]) {
    control.disabled = !configLoaded || settingsBusy;
  }
  for (const control of document.querySelectorAll('#download-path, #auto-install, #cached-only, #archive-password, #browse-folder, #keep-archives, #transfer-timeout, #automatic-updates, #preferred-language, #preferred-release, #notifications, [data-palette], #import-config, #export-config')) control.disabled = !configLoaded || settingsBusy;
  document.querySelector('#remove-key').disabled = !configLoaded || settingsBusy || !keyConfigured;
  document.querySelector('#remove-key').hidden = configLoaded && !keyConfigured;
}
updateSettingsState();
const configReady = window.torboxSettings
  ? window.torboxSettings.loadConfig(urls).then((config) => {
    applyLoadedConfig(config);
    return config;
  })
  : Promise.reject(new Error('Open Mamba in the desktop app to access config.json.'));
configReady.catch((error) => {
  document.querySelector('#key-status').textContent = 'Unavailable';
  saveStatus.classList.add('error');
  saveStatus.textContent = error.message || 'Could not read config.json.';
  showToast(error.message || 'Could not read config.json.');
});

function loadUrls() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function openSettings() {
  if (!backdrop.hidden) return;
  saveStatus.textContent = '';
  saveStatus.classList.remove('error');
  if (!settingsInitialized) sourceUrlsInput.value = urls.join('\n');
  sourceUrlsInput.setCustomValidity('');
  keyInput.type = 'password';
  updateSettingsState();
  showPage('settings');
}

function showToast(message, actionLabel, action) {
  toast.replaceChildren(document.createTextNode(String(message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')));
  if (actionLabel && action) toast.append(button(actionLabel, async () => { await action(); toast.classList.remove('visible'); }, actionLabel === 'Play' ? 'play' : 'arrow-right', 'text-button toast-action'));
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), actionLabel ? 10000 : 2200);
}

document.querySelector('#settings-open').addEventListener('click', openSettings);
document.querySelector('#search-setup').addEventListener('click', openSettings);
document.querySelector('#main-search').addEventListener('input', updateSearchState);
document.querySelector('#main-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(), 400); });
document.querySelector('#main-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });
document.querySelector('#results-more').addEventListener('click', () => runSearch(true));
document.querySelector('#sync-catalog').addEventListener('click', () => window.mamba.sync().catch((error) => showToast(error.message)));
document.querySelector('#settings-sync').addEventListener('click', () => window.mamba.sync().catch((error) => showToast(error.message)));
document.querySelector('#refresh-library').addEventListener('click', () => window.mamba.library().then(renderLibrary).catch((error) => showToast(error.message)));
document.querySelector('#search-clear').addEventListener('click', () => {
  document.querySelector('#main-search').value = '';
  updateSearchState();
  runSearch();
  document.querySelector('#main-search').focus();
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    showPage('search');
    document.querySelector('#main-search').select();
  }
  if (event.key === 'Escape' && document.activeElement === document.querySelector('#main-search')) {
    document.querySelector('#main-search').value = '';
    updateSearchState();
    runSearch();
  }
});

sourceUrlsInput.addEventListener('input', () => {
  sourceUrlsInput.setAttribute('aria-invalid', 'false');
  document.querySelector('#source-error').hidden = true;
  saveStatus.textContent = '';
  scheduleSettingsSave(900);
});
keyInput.addEventListener('input', () => { saveStatus.textContent = ''; scheduleSettingsSave(700); });
document.querySelector('#key-visibility').addEventListener('click', () => {
  const showing = keyInput.type === 'text';
  keyInput.type = showing ? 'password' : 'text';
  updateSettingsState();
});

document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (settingsBusy || !configLoaded || !hasSettingsChanges()) return;
  saveStatus.textContent = '';
  saveStatus.classList.remove('error');
  const nextUrls = [...new Set(sourceLines())];
  const invalidIndex = nextUrls.findIndex((value) => {
    try {
      return !['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return true;
    }
  });
  if (invalidIndex !== -1) {
    const message = `Source ${invalidIndex + 1} needs a valid HTTP or HTTPS JSON URL.`;
    sourceUrlsInput.setAttribute('aria-invalid', 'true');
    document.querySelector('#source-error').textContent = message;
    document.querySelector('#source-error').hidden = false;
    sourceUrlsInput.focus();
    return;
  }
  try {
    settingsBusy = true;
    updateSettingsState();
    await configReady;
    const preferences = readDownloadPreferences();
    const result = await window.torboxSettings.saveConfig({ apiKey: keyInput.value, realDebridApiKey:window.MambaSettings?.key()||'',sourceUrls: nextUrls, ...preferences });
    downloadPreferences = preferences;
    applyPalette(preferences.palette);
    keyConfigured = result.configured;
    window.MambaSettings?.saved(result);

    urls = result.sourceUrls;

    sourceUrlsInput.value = urls.join('\n');
    keyInput.value = '';
    keyInput.type = 'password';
    saveStatus.textContent = 'Settings saved.';
    updateSearchState();
    keyInput.placeholder = keyConfigured ? 'Saved · enter a new key to replace' : 'Paste your API key';
  } catch (error) {
    saveStatus.textContent = error.message || 'Could not save settings.';
    saveStatus.classList.add('error');
    showToast(saveStatus.textContent);
  } finally {
    settingsBusy = false;
    updateSettingsState();
  }
});

function applyPalette(palette) {
  for (const [name,color] of Object.entries(palette || {})) if (/^#[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--color-'+name,color);
}

// Adapt only text and icon ink. Composite visible art, surface opacity, and
// translucent UI fills first so each item moves in proportion to its backdrop.
const adaptivePixels=new WeakMap(),adaptivePending=new Set();
const adaptiveTargets='button,input:not([type=color]):not([type=range]):not([type=checkbox]),textarea,select,.page,.settings-card,.filter-empty,.game-card,.version-card,.transfer-row,.quiet-state,.speed-card,.recent-card,p,label,small,output,.field-label,.search-wordmark,.search-shortcut,.sidebar,h1,h2,h3,h4,strong,span,a,li,summary,legend,dt,dd,th,td,svg';
const adaptiveCanvas=document.createElement('canvas');adaptiveCanvas.width=adaptiveCanvas.height=1;
const adaptiveContext=adaptiveCanvas.getContext('2d',{willReadFrequently:true});
const adaptiveColorCache=new Map();let adaptiveFrame;
function rgbaFor(value){let result=adaptiveColorCache.get(value);if(result)return result;adaptiveContext.clearRect(0,0,1,1);adaptiveContext.fillStyle='#000000';adaptiveContext.fillStyle=value;adaptiveContext.fillRect(0,0,1,1);result=[...adaptiveContext.getImageData(0,0,1,1).data];adaptiveColorCache.set(value,result);if(adaptiveColorCache.size>256)adaptiveColorCache.clear();return result;}
function overColor(base,layer,opacity=1){const alpha=layer[3]/255*opacity,remain=1-alpha;return [0,1,2].map(index=>Math.round(layer[index]*alpha+base[index]*remain)).concat(255);}
function displayedBackground(element){
  const rootStyle=getComputedStyle(document.documentElement),base=rgbaFor(rootStyle.getPropertyValue('--color-primary').trim()||'#181818');let result=base;
  const backdrop=document.querySelector('#steam-backdrop');let sampled=false;
  if(backdrop){const bounds=element.getBoundingClientRect(),x=bounds.left+bounds.width/2,y=bounds.top+bounds.height/2;
    for(const image of backdrop.querySelectorAll('img')){const opacity=Number(getComputedStyle(image).opacity);if(!image.naturalWidth||opacity<=0)continue;
      if(!adaptivePixels.has(image)){try{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=50;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,80,50);adaptivePixels.set(image,context.getImageData(0,0,80,50).data);}catch{adaptivePixels.set(image,null);}}
      const pixels=adaptivePixels.get(image);if(!pixels)continue;const rect=image.getBoundingClientRect(),scale=Math.max(rect.width/image.naturalWidth,rect.height/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;
      const px=Math.max(0,Math.min(79,Math.round((x-rect.left+(width-rect.width)/2)/width*80))),py=Math.max(0,Math.min(49,Math.round((y-rect.top+(height-rect.height)/2)/height*50))),offset=(py*80+px)*4;
      result=overColor(result,[pixels[offset],pixels[offset+1],pixels[offset+2],255],opacity);sampled=true;
    }
    if(sampled){const tint=Number(rootStyle.getPropertyValue('--background-opacity'))||0;result=overColor(result,base,tint);const groupOpacity=Number(getComputedStyle(backdrop).opacity);result=overColor(base,result,groupOpacity);}
  }
  const layers=[];for(let node=element;node&&node!==document.body&&node!==document.documentElement;node=node.parentElement)layers.push(node);
  for(let index=layers.length-1;index>=0;index--){const node=layers[index],fill=getComputedStyle(node).backgroundColor;if(fill!=='rgba(0, 0, 0, 0)'&&fill!=='transparent')result=overColor(result,rgbaFor(fill));}
  return '#'+result.slice(0,3).map(value=>value.toString(16).padStart(2,'0')).join('');
}
function queueAdaptiveColors(root=document){if(root.matches?.(adaptiveTargets))adaptivePending.add(root);root.querySelectorAll?.(adaptiveTargets).forEach(element=>adaptivePending.add(element));if(adaptiveFrame)return;adaptiveFrame=requestAnimationFrame(()=>{adaptiveFrame=null;const api=window.MambaThemes;if(!api)return;const styles=getComputedStyle(document.documentElement),textColor=styles.getPropertyValue('--theme-text-color').trim()||styles.getPropertyValue('--color-text').trim(),iconColor=styles.getPropertyValue('--theme-icons-color').trim()||styles.getPropertyValue('--color-icons').trim();for(const element of adaptivePending){if(!element.isConnected||!element.getClientRects().length)continue;const background=displayedBackground(element),textInk=api.adaptiveColor(textColor,background),iconInk=api.adaptiveColor(iconColor,background);element.style.setProperty('--body-ink',textInk);element.style.setProperty('--button-ink',textInk);element.style.setProperty('--heading-ink',textInk);element.style.setProperty('--icon-ink',iconInk);element.style.setProperty('--divider-ink',iconInk);element.style.setProperty('--scrollbar-ink',iconInk);if(element.matches('.page,.source-errors,textarea'))for(const track of document.querySelectorAll('.ui-scrollbar'))if(track.getAttribute('aria-controls')===element.id)track.style.setProperty('--scrollbar-ink',iconInk);}adaptivePending.clear();});}
window.MambaAppearanceContrast={refresh:()=>queueAdaptiveColors(document)};
new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')queueAdaptiveColors(record.target);for(const node of record.addedNodes)if(node.nodeType===1)queueAdaptiveColors(node);}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-pressed']});
setInterval(()=>{if(!document.hidden)queueAdaptiveColors(document);},450);
queueAdaptiveColors(document);
function applyLoadedConfig(config) {
  urls=config.sourceUrls; keyConfigured=config.configured; keyInput.value='';
  downloadPreferences={downloadPath:config.downloadPath,autoInstall:config.autoInstall,cachedOnly:config.cachedOnly,archivePassword:config.archivePassword||'',keepArchives:!!config.keepArchives,transferTimeoutMinutes:config.transferTimeoutMinutes||120,automaticUpdates:config.automaticUpdates!==false,palette:config.palette||{},preferredLanguage:config.preferredLanguage||'english',preferredRelease:config.preferredRelease||'any',notifications:config.notifications!==false,enabledDownloadServices:config.enabledDownloadServices||['torbox','direct'],preferredDownloadService:config.preferredDownloadService||'auto',disabledDownloadHosts:config.disabledDownloadHosts||[],disabledSourceUrls:config.disabledSourceUrls||[]};
  const fields=document.querySelector('#palette-fields');fields.replaceChildren();
  for(const [name,color]of Object.entries(downloadPreferences.palette)){
    const label=document.createElement('label');label.className='palette-field';
    const input=document.createElement('input');input.type='color';input.value=color;input.dataset.palette=name;input.setAttribute('aria-label',name.replace(/([A-Z])/g,' $1'));
    const text=document.createElement('span');text.textContent=name.replace(/([A-Z])/g,' $1');label.append(input,text);fields.append(label);
    input.addEventListener('input',()=>{saveStatus.textContent='';applyPalette(readDownloadPreferences().palette);scheduleSettingsSave(650);});
  }
  applyPalette(downloadPreferences.palette);populateDownloadPreferences();renderLibrary(config.installedGames||installedGames);
  window.MambaExperience?.configure(config);
  configLoaded=true;settingsInitialized=true;localStorage.removeItem(STORAGE_KEY);sourceUrlsInput.value=urls.join('\n');window.MambaSettings?.configure(config);updateSettingsState();updateSearchState();
  window.MambaAppearance?.configure(config);
}
function readDownloadPreferences() {
  return { ...(window.MambaSettings?.read()||{enabledDownloadServices:downloadPreferences.enabledDownloadServices||['torbox','direct'],preferredDownloadService:downloadPreferences.preferredDownloadService||'auto',disabledDownloadHosts:downloadPreferences.disabledDownloadHosts||[],disabledSourceUrls:downloadPreferences.disabledSourceUrls||[]}),preferredLanguage:document.querySelector('#preferred-language').value,preferredRelease:document.querySelector('#preferred-release').value,notifications:document.querySelector('#notifications').checked,downloadPath: document.querySelector('#download-path').value.trim(), autoInstall: document.querySelector('#auto-install').checked, cachedOnly: document.querySelector('#cached-only').checked, archivePassword: document.querySelector('#archive-password').value, keepArchives:document.querySelector('#keep-archives').checked,transferTimeoutMinutes:Number(document.querySelector('#transfer-timeout').value),automaticUpdates:document.querySelector('#automatic-updates').checked,palette:Object.fromEntries([...document.querySelectorAll('[data-palette]')].map(input=>[input.dataset.palette,input.value])),...(window.MambaAppearance?.read()||{}) };
}
function populateDownloadPreferences() {
  document.querySelector('#preferred-language').value=downloadPreferences.preferredLanguage||'english';
  document.querySelector('#preferred-release').value=downloadPreferences.preferredRelease||'any';
  document.querySelector('#notifications').checked=downloadPreferences.notifications!==false;
  document.querySelector('#download-path').value = downloadPreferences.downloadPath || '';
  document.querySelector('#auto-install').checked = downloadPreferences.autoInstall;
  document.querySelector('#cached-only').checked = downloadPreferences.cachedOnly;
  document.querySelector('#archive-password').value = downloadPreferences.archivePassword;
  document.querySelector('#keep-archives').checked = downloadPreferences.keepArchives;
  document.querySelector('#transfer-timeout').value = downloadPreferences.transferTimeoutMinutes;
  document.querySelector('#automatic-updates').checked = downloadPreferences.automaticUpdates;
  for(const input of document.querySelectorAll('[data-palette]'))input.value=downloadPreferences.palette[input.dataset.palette];
  applyPalette(downloadPreferences.palette);
}
for (const control of document.querySelectorAll('#download-path, #auto-install, #cached-only, #archive-password, #keep-archives, #transfer-timeout, #automatic-updates, #preferred-language, #preferred-release, #notifications')) {
  const save = () => { saveStatus.textContent=''; scheduleSettingsSave(control.matches('input[type="text"], input[type="password"], input[type="number"]') ? 800 : 350); };
  control.addEventListener('input', save);
  control.addEventListener('change', save);
}

document.querySelector('#browse-folder').addEventListener('click', async () => {
  try { const folder = await window.mamba.chooseFolder(); if (folder) { document.querySelector('#download-path').value = folder; scheduleSettingsSave(150); } }
  catch (error) { window.MambaExperience?.handleError(error) || showToast(error.message); }
});
if (window.mamba) {
  window.mamba.onCatalog(renderCatalog);
  window.mamba.onJobs(renderJobs);
  window.mamba.onLibrary(renderLibrary);
  window.mamba.onNotice(notice => {
    if (notice.status === 'completed' && notice.libraryId) showToast(`${notice.name} is ready. Play now?`, 'Play', () => window.mamba.gameAction(notice.libraryId, 'play'));
    else if (notice.status === 'needs-setup') showToast(`${notice.name} needs setup. Review it in your Library.`, 'Open library', () => showPage('library'));
  });
  window.mamba.catalogStatus().then(renderCatalog).catch((error) => showToast(error.message));
  window.mamba.jobs().then(renderJobs).catch((error) => showToast(error.message));
}

document.querySelector('#remove-key').addEventListener('click', async () => {
  if (settingsBusy || !configLoaded) return;
  try {
    settingsBusy = true;
    updateSettingsState();
    await configReady;
    await window.torboxSettings.clearKey();
    keyConfigured = false;

    keyInput.value = '';
    keyInput.type = 'password';
    keyInput.placeholder = 'Paste your API key';
    saveStatus.classList.remove('error');
    saveStatus.textContent = 'API key removed.';
  } catch (error) {
    saveStatus.classList.add('error');
    saveStatus.textContent = error.message || 'Could not remove the API key.';
  } finally {
    settingsBusy = false;
    updateSettingsState();
  }
});




for(const action of ['import','export'])document.querySelector('#'+action+'-config').addEventListener('click',async()=>{
  if(settingsBusy)return;settingsBusy=true;updateSettingsState();
  try{const result=await window.torboxSettings[action+'Config']();if(result){if(action==='import'){applyLoadedConfig(result);runSearch();}showToast(action==='import'?'Configuration loaded.':'Complete configuration exported.');}}catch(error){showToast(error.message);}finally{settingsBusy=false;updateSettingsState();}
});
function renderUpdate(state){
  document.querySelector('#search-version').textContent=state.version?'v'+state.version:'';
  document.querySelector('#search-version').hidden=!state.version;
  document.querySelector('#app-version').textContent=state.version?'v'+state.version:'';
  document.querySelector('#update-status').textContent=state.message;
  document.querySelector('#update-badge').textContent=({ready:'Ready to install',current:'Up to date',checking:'Checking',downloading:'Downloading',error:'Unavailable',development:'Development',idle:'Stable'})[state.status]||'Stable';
  document.querySelector('#check-updates').disabled=['checking','downloading','ready'].includes(state.status);
  document.querySelector('#install-update').hidden=state.status!=='ready';
}
document.querySelector('#check-updates').addEventListener('click',async()=>{try{renderUpdate(await window.mamba.checkUpdates());}catch(error){showToast(error.message);}});
document.querySelector('#install-update').addEventListener('click',async()=>{try{await window.mamba.installUpdate();}catch(error){showToast(error.message);}});
if(window.mamba){window.mamba.onUpdate(renderUpdate);window.mamba.updateState().then(renderUpdate).catch(error=>showToast(error.message));}
