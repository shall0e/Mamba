const backdrop = document.querySelector('#settings-backdrop');
const keyInput = document.querySelector('#api-key');
const sourceUrlsInput = document.querySelector('#source-urls');
const saveStatus = document.querySelector('#save-status');
const toast = document.querySelector('#toast');
let downloadPreferences = { downloadPath: '', autoInstall: true, cachedOnly: true, archivePassword: '', keepArchives:false, transferTimeoutMinutes:120, automaticUpdates:true, palette:{} };
let searchGeneration = 0;
let searchTimer;
let searchOffset = 0;
let catalogState = {};
let detailGeneration = 0;
const cardJobs = new Map();

function icon(name) { return document.querySelector(`#icon-${name}`)?.content.cloneNode(true) || document.createDocumentFragment(); }
function button(label, action, iconName, className = 'text-button') {
  const control = document.createElement('button'); control.type = 'button'; control.className = className;
  if (iconName) control.append(icon(iconName));
  control.append(document.createTextNode(label));
  control.addEventListener('click', async () => {
    control.disabled = true;control.setAttribute('aria-busy','true');
    try { await action(); } catch (error) { window.MambaExperience?.handleError(error) || showToast(error.message); } finally { control.removeAttribute('aria-busy');control.disabled = control.dataset.locked === 'true'; }
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
  catalogState = state;
  const text = state.message + (state.errors?.length ? ` · ${state.errors.length} sources unavailable` : '');
  document.querySelector('#catalog-status').textContent = text;
  document.querySelector('#settings-catalog-status').textContent = text;
  const errorList = document.querySelector('#source-errors'); errorList.replaceChildren(); errorList.hidden = !state.errors?.length;
  for (const error of state.errors || []) { const item = document.createElement('li'); item.textContent = `${error.source}: ${error.message}`; errorList.append(item); }
  document.querySelector('#sync-catalog').disabled = ['fetching', 'merging', 'checking'].includes(state.phase);
  document.querySelector('#settings-sync').disabled = document.querySelector('#sync-catalog').disabled;
  if (document.querySelector('#game-detail').hidden && document.querySelector('#main-search').value.trim() && (state.phase === 'ready' || previousCount !== state.count)) runSearch();
  if (!document.querySelector('#main-search').value.trim()) document.querySelector('#search-context').textContent = text;
}
async function runSearch(more = false) {
  const query = document.querySelector('#main-search').value.trim();
  const generation = ++searchGeneration;
  detailGeneration++;
  document.querySelector('#game-detail').hidden = true;
  document.querySelector('#results-browse').hidden = false;
  const page = document.querySelector('#search-page');
  page.classList.toggle('has-results', Boolean(query));
  document.querySelector('#search-results').hidden = !query;
  if (!query || !window.mamba) return;
  if (!more) { searchOffset = 0; document.querySelector('#results-list').replaceChildren(); }
  document.querySelector('#results-status').textContent = 'Searching…';
  try {
    const result = await window.mamba.search(query, searchOffset);
    if (generation !== searchGeneration) return;
    for (const game of result.items) {
      const row = document.createElement('article'); row.className = 'result-card game-cover-card';
      const cover = document.createElement('button'); cover.type = 'button'; cover.className = 'game-cover'; cover.setAttribute('aria-label', `View ${game.name}`);
      cover.append(document.querySelector('#library-empty svg').cloneNode(true));
      cover.addEventListener('click', () => openGame(game));
      window.mamba.artwork(game.id).then((image) => {
        if (!image || !cover.isConnected) return;
        const img = document.createElement('img'); img.src = image; img.alt = `${game.name} cover`; img.loading = 'lazy'; img.decoding = 'async';
        img.addEventListener('load', () => cover.classList.add('has-cover'));
        img.addEventListener('error', () => img.remove()); cover.append(img);
      }).catch(() => {});
      const details = document.createElement('div'); details.className = 'result-info';
      const heading = document.createElement('h2'); heading.textContent = game.name;
      const meta = document.createElement('p');
      meta.textContent = `${game.options.length} ${game.options.length === 1 ? 'download option' : 'download options'} · ${game.sources.length} ${game.sources.length === 1 ? 'source' : 'sources'}`;
      details.append(heading, meta);
      const actions = document.createElement('div'); actions.className = 'result-actions';
      actions.classList.add('game-result-action');
      const download = button('Download', async () => {
        download.lastChild.textContent = 'Finding best…';
        try {
          const jobId = await window.mamba.downloadBest(game.id);
          download.dataset.jobId = jobId; download.dataset.locked = 'true'; download.lastChild.textContent = 'Queued';
          cardJobs.set(game.id, jobId); showToast(`${game.name} added to downloads`);
        } catch (error) { download.lastChild.textContent = 'Download'; throw error; }
      }, 'download', 'primary-button');
      if (cardJobs.has(game.id)) { download.dataset.jobId = cardJobs.get(game.id); download.dataset.locked = 'true'; download.disabled = true; download.lastChild.textContent = 'Queued'; }
      actions.append(download, button('Options', () => openGame(game), null, 'text-button card-options'));
      row.append(cover, details, actions); document.querySelector('#results-list').append(row);
    }
    searchOffset += result.items.length;
    document.querySelector('#results-more').hidden = searchOffset >= result.total;
    document.querySelector('#results-status').textContent = result.total ? `${result.total.toLocaleString()} ${result.total === 1 ? 'game' : 'games'}` : ['fetching', 'merging', 'checking'].includes(catalogState.phase) ? 'The catalog is syncing. Results will appear when checks finish.' : 'No TorBox-ready games found. Try another name or sync your sources.';
  } catch (error) { document.querySelector('#results-status').textContent = error.message; }
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
      const message = document.createElement('p'); message.className = 'transfer-message';
      const bar = document.createElement('progress'); bar.max = 100; bar.setAttribute('aria-label', `Progress for ${job.name}`);
      const actions = document.createElement('div'); actions.className = 'transfer-actions';
      const stages=document.createElement('ol');stages.className='transfer-stages';stages.setAttribute('aria-label','Download stages');for(const label of ['Preparing','Downloading','Extracting','Installing','Ready']){const stage=document.createElement('li');stage.textContent=label;stages.append(stage);}
      row.append(name, stages, message, bar, actions); list.append(row);
    }
    row.querySelector('.transfer-message').textContent = (job.error ? job.error.title + ' · ' + job.error.advice : job.message) + (job.status === 'downloading' ? ` · ${formatBytes(job.received)} / ${formatBytes(job.total)} · ${(Math.max(0, Number(job.speed) || 0) / 1000000).toFixed(1)} MB/s · ${remainingTime(job)}` : '');
    const current={queued:0,preparing:0,downloading:1,extracting:2,installing:3,completed:4,'needs-setup':3}[['paused','failed','cancelled'].includes(job.status)?job.stage:job.status];
    [...row.querySelectorAll('.transfer-stages li')].forEach((node,index)=>{node.classList.toggle('stage-done',current!==undefined&&index<current);node.classList.toggle('stage-current',index===current);node.setAttribute('aria-current',index===current?'step':'false');});
    row.querySelector('progress').value = job.progress || 0;
    row.querySelector('progress').hidden=['paused','failed','cancelled','needs-setup'].includes(job.status);
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
let installedGames = [];
let settingsInitialized = false;

function sourceLines() {
  return sourceUrlsInput.value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function hasSettingsChanges() {
  return Boolean(keyInput.value.trim()) || JSON.stringify([...new Set(sourceLines())]) !== JSON.stringify(urls) || JSON.stringify(Object.entries(readDownloadPreferences()).sort(([a],[b])=>a.localeCompare(b))) !== JSON.stringify(Object.entries(downloadPreferences).sort(([a],[b])=>a.localeCompare(b)));
}

function updateSearchState() {
  const populated = Boolean(document.querySelector('#main-search').value);
  document.querySelector('#search-clear').hidden = !populated;
  document.querySelector('#search-shortcut').hidden = populated;
  document.querySelector('#search-setup').hidden = !configLoaded || urls.length > 0;
  document.querySelector('#search-context').textContent = configLoaded && urls.length
    ? `${urls.length} ${urls.length === 1 ? 'source' : 'sources'} in your collection.`
    : 'Your next game starts here.';
}

function updateSettingsState() {
  const visibility = document.querySelector('#key-visibility');
  visibility.classList.toggle('revealed', keyInput.type === 'text');
  visibility.setAttribute('aria-label', keyInput.type === 'text' ? 'Hide API key' : 'Show API key');
  visibility.title = visibility.getAttribute('aria-label');
  document.querySelector('#key-status').textContent = !configLoaded ? 'Loading…' : keyConfigured ? 'Key saved' : 'Not connected';
  document.querySelector('#key-status').classList.toggle('configured', keyConfigured);
  keyInput.placeholder = keyConfigured ? 'Saved · enter a new key to replace' : 'Paste your API key';
  const count = new Set(sourceLines()).size;
  document.querySelector('#source-count').textContent = `${count} ${count === 1 ? 'source' : 'sources'}`;
  for (const control of [keyInput, sourceUrlsInput, visibility, document.querySelector('#settings-save')]) {
    control.disabled = !configLoaded || settingsBusy;
  }
  for (const control of document.querySelectorAll('#download-path, #auto-install, #cached-only, #archive-password, #browse-folder, #keep-archives, #transfer-timeout, #automatic-updates, #preferred-language, #preferred-release, #notifications, [data-palette], #import-config, #export-config')) control.disabled = !configLoaded || settingsBusy;
  document.querySelector('#remove-key').disabled = !configLoaded || settingsBusy || !keyConfigured;
  document.querySelector('#remove-key').hidden = configLoaded && !keyConfigured;
  document.querySelector('#settings-save').disabled = !configLoaded || settingsBusy || !hasSettingsChanges();
  document.querySelector('#settings-cancel').disabled = !configLoaded || settingsBusy || !hasSettingsChanges();
  document.querySelector('#settings-save').textContent = settingsBusy ? 'Saving…' : 'Save changes';
  document.querySelector('#settings-state').textContent = !configLoaded ? 'Loading settings…' : settingsBusy ? 'Saving changes…' : hasSettingsChanges() ? 'Unsaved changes' : 'All changes saved';
  document.querySelector('#settings-state').classList.toggle('dirty', configLoaded && hasSettingsChanges());
  document.querySelector('#settings-state').hidden = Boolean(saveStatus.textContent);
}
updateSettingsState();
const configReady = window.torboxSettings
  ? window.torboxSettings.loadConfig(urls).then((config) => {
    applyLoadedConfig(config);
  })
  : Promise.reject(new Error('Open Mamba in the desktop app to access config.json.'));
configReady.catch((error) => {
  document.querySelector('#key-status').textContent = 'Unavailable';
  document.querySelector('#settings-state').textContent = 'Settings could not be loaded';
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

function closeSettings() {
  keyInput.value = '';
  keyInput.type = 'password';
  sourceUrlsInput.value = urls.join('\n');
  populateDownloadPreferences();
  sourceUrlsInput.setAttribute('aria-invalid', 'false');
  document.querySelector('#source-error').hidden = true;
  saveStatus.textContent = '';
  updateSettingsState();
}

function showToast(message) {
  toast.textContent = String(message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

document.querySelector('#settings-open').addEventListener('click', openSettings);
document.querySelector('#search-setup').addEventListener('click', openSettings);
document.querySelector('#main-search').addEventListener('input', updateSearchState);
document.querySelector('#main-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(), 220); });
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !backdrop.hidden) {
    event.preventDefault();
    if (!document.querySelector('#settings-save').disabled) document.querySelector('#settings-form').requestSubmit();
  }
  if (event.key === 'Escape' && document.activeElement === document.querySelector('#main-search')) {
    document.querySelector('#main-search').value = '';
    updateSearchState();
    runSearch();
  }
});

document.querySelector('#settings-cancel').addEventListener('click', closeSettings);
sourceUrlsInput.addEventListener('input', () => {
  sourceUrlsInput.setAttribute('aria-invalid', 'false');
  document.querySelector('#source-error').hidden = true;
  saveStatus.textContent = '';
  updateSettingsState();
});
keyInput.addEventListener('input', () => { saveStatus.textContent = ''; updateSettingsState(); });
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
    const result = await window.torboxSettings.saveConfig({ apiKey: keyInput.value, sourceUrls: nextUrls, ...preferences });
    downloadPreferences = preferences;
    applyPalette(preferences.palette);
    keyConfigured = result.configured;

    urls = result.sourceUrls;

    sourceUrlsInput.value = urls.join('\n');
    keyInput.value = '';
    keyInput.type = 'password';
    saveStatus.textContent = 'Changes saved.';
    updateSearchState();
    keyInput.placeholder = keyConfigured ? 'Saved · enter a new key to replace' : 'Paste your API key';
  } catch (error) {
    saveStatus.textContent = error.message || 'Could not save settings.';
    saveStatus.classList.add('error');
  } finally {
    settingsBusy = false;
    updateSettingsState();
  }
});

function applyPalette(palette) {
  for (const [name,color] of Object.entries(palette || {})) if (/^#[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--color-'+name,color);
}
function applyLoadedConfig(config) {
  urls=config.sourceUrls; keyConfigured=config.configured; keyInput.value='';
  downloadPreferences={downloadPath:config.downloadPath,autoInstall:config.autoInstall,cachedOnly:config.cachedOnly,archivePassword:config.archivePassword||'',keepArchives:!!config.keepArchives,transferTimeoutMinutes:config.transferTimeoutMinutes||120,automaticUpdates:config.automaticUpdates!==false,palette:config.palette||{},preferredLanguage:config.preferredLanguage||'english',preferredRelease:config.preferredRelease||'any',notifications:config.notifications!==false};
  const fields=document.querySelector('#palette-fields');fields.replaceChildren();
  for(const [name,color]of Object.entries(downloadPreferences.palette)){
    const label=document.createElement('label');label.className='palette-field';
    const input=document.createElement('input');input.type='color';input.value=color;input.dataset.palette=name;input.setAttribute('aria-label',name.replace(/([A-Z])/g,' $1'));
    const text=document.createElement('span');text.textContent=name.replace(/([A-Z])/g,' $1');label.append(input,text);fields.append(label);
    input.addEventListener('input',()=>{saveStatus.textContent='';applyPalette(readDownloadPreferences().palette);updateSettingsState();});
  }
  applyPalette(downloadPreferences.palette);populateDownloadPreferences();renderLibrary(config.installedGames||installedGames);
  window.MambaExperience?.configure(config);
  configLoaded=true;settingsInitialized=true;localStorage.removeItem(STORAGE_KEY);sourceUrlsInput.value=urls.join('\n');updateSettingsState();updateSearchState();
}
function readDownloadPreferences() {
  return { preferredLanguage:document.querySelector('#preferred-language').value,preferredRelease:document.querySelector('#preferred-release').value,notifications:document.querySelector('#notifications').checked,downloadPath: document.querySelector('#download-path').value.trim(), autoInstall: document.querySelector('#auto-install').checked, cachedOnly: document.querySelector('#cached-only').checked, archivePassword: document.querySelector('#archive-password').value, keepArchives:document.querySelector('#keep-archives').checked,transferTimeoutMinutes:Number(document.querySelector('#transfer-timeout').value),automaticUpdates:document.querySelector('#automatic-updates').checked,palette:Object.fromEntries([...document.querySelectorAll('[data-palette]')].map(input=>[input.dataset.palette,input.value])) };
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
for (const control of document.querySelectorAll('#download-path, #auto-install, #cached-only, #archive-password, #keep-archives, #transfer-timeout, #automatic-updates, #preferred-language, #preferred-release, #notifications')) control.addEventListener('input',()=>{saveStatus.textContent='';updateSettingsState();});

document.querySelector('#browse-folder').addEventListener('click', async () => {
  try { const folder = await window.mamba.chooseFolder(); if (folder) { document.querySelector('#download-path').value = folder; updateSettingsState(); } }
  catch (error) { window.MambaExperience?.handleError(error) || showToast(error.message); }
});
if (window.mamba) {
  window.mamba.onCatalog(renderCatalog);
  window.mamba.onJobs(renderJobs);
  window.mamba.onLibrary(renderLibrary);
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
  document.querySelector('#app-version').textContent='v'+state.version;
  document.querySelector('#update-status').textContent=state.message;
  document.querySelector('#update-badge').textContent=({ready:'Ready to install',current:'Up to date',checking:'Checking',downloading:'Downloading',error:'Unavailable',development:'Development',idle:'Stable'})[state.status]||'Stable';
  document.querySelector('#check-updates').disabled=['checking','downloading','ready'].includes(state.status);
  document.querySelector('#install-update').hidden=state.status!=='ready';
}
document.querySelector('#check-updates').addEventListener('click',async()=>{try{renderUpdate(await window.mamba.checkUpdates());}catch(error){showToast(error.message);}});
document.querySelector('#install-update').addEventListener('click',async()=>{try{await window.mamba.installUpdate();}catch(error){showToast(error.message);}});
if(window.mamba){window.mamba.onUpdate(renderUpdate);window.mamba.updateState().then(renderUpdate).catch(error=>showToast(error.message));}
