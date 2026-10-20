const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, utilityProcess, Notification, Tray, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const defaultPalette = require('./palette-defaults.json');
const brandIcon = path.join(__dirname,'assets','mamba.png');
const { within } = require('./lib/library.cjs');
const {authorizeGame}=require('./lib/experience.cjs');
const {Issues,safeMessage}=require('./lib/issues.cjs');
const {Themes}=require('./lib/themes.cjs');
const {parse:parseTheme}=require('./theme-model.js');
const issues=new Issues();let issueQueue=Promise.resolve();
let configSecrets=[];
function reportIssue(error,context='app'){const issue=issues.add(error,context,configSecrets);broadcast('issues:changed',issues.items);issueQueue=issueQueue.catch(()=>{}).then(()=>fs.writeFile(path.join(dataDirectory(),'issues.json'),JSON.stringify(issues.items))).catch(()=>{});return issue;}
const { registerHelperRuntime, openGameHelper } = require('./lib/game-helper.cjs');
const { validateSettings, decodeConfig, encodeConfig } = require('./lib/config-transfer.cjs');
const { Updates } = require('./lib/updates.cjs');
const { BackgroundClient } = require('./lib/background-client.cjs');
const { spawn } = require('node:child_process');
let updates, background, configWatcher, watchTimer, resolvedDataDirectory;
let installedGames = [], downloadJobs = [];
let catalogState = { phase: 'loading', message: 'Starting background service…', count: 0, errors: [] };
async function task(method, ...args) {
  if (!background) return Promise.reject(new Error('Mamba is starting. Try again shortly.'));
  try { return await background.request(method, ...args); } catch(error) { reportIssue(error,method);throw error; }
}
async function refreshBackgroundConfig() {
  if (!background) return;
  const config = await readConfig();
  const previous=background.options.initialize.config;
  const changed=JSON.stringify([previous.sourceUrls,previous.torboxApiKey,previous.cachedOnly,previous.realDebridApiKey,previous.enabledDownloadServices,previous.disabledDownloadHosts,previous.disabledSourceUrls])!==JSON.stringify([config.sourceUrls,config.torboxApiKey,config.cachedOnly,config.realDebridApiKey,config.enabledDownloadServices,config.disabledDownloadHosts,config.disabledSourceUrls]);
  configSecrets=[config.torboxApiKey,config.realDebridApiKey,config.archivePassword];
  background.options.initialize.config = config;
  await task('configure', config);
  if(changed)task('catalog:sync').catch(()=>{});
}
function dataDirectory() {
  if (resolvedDataDirectory) return resolvedDataDirectory;
  if (!app.isPackaged) return resolvedDataDirectory = process.env.MAMBA_DATA_DIR ? path.resolve(process.env.MAMBA_DATA_DIR) : __dirname;
  // A local dist/win-unpacked build shares the project's existing configuration.
  // Moving the app elsewhere gives it normal per-user storage, without shipping keys.
  const project = path.resolve(path.dirname(process.execPath), '..', '..');
  try {
    const metadata = JSON.parse(require('node:fs').readFileSync(path.join(project, 'package.json'), 'utf8'));
    if (metadata.name === 'minimal-downloader' && require('node:fs').existsSync(path.join(project, 'main.cjs')) && require('node:fs').existsSync(path.join(project, 'config.json'))) return resolvedDataDirectory = project;
  } catch {}
  const legacyData = path.join(app.getPath('appData'), 'minimal-downloader');
  if (require('node:fs').existsSync(path.join(legacyData, 'config.json'))) return resolvedDataDirectory = legacyData;
  return resolvedDataDirectory = app.getPath('userData');
}
const publicConfig = (config) => ({onboardingCompleted:config.onboardingCompleted!==false,appearance:config.appearance||null,enabledDownloadServices:config.enabledDownloadServices||['torbox','direct'],preferredDownloadService:config.preferredDownloadService||'auto',disabledDownloadHosts:config.disabledDownloadHosts||[],disabledSourceUrls:config.disabledSourceUrls||[],realDebridConfigured:!!config.realDebridApiKey,librarySort:config.librarySort||'name',libraryFavoritesOnly:!!config.libraryFavoritesOnly,notifications:config.notifications!==false,preferredLanguage:config.preferredLanguage||'english',preferredRelease:config.preferredRelease||'any', configured: Boolean(config.torboxApiKey), sourceUrls: config.sourceUrls, palette: config.palette, downloadPath: config.downloadPath, autoInstall: config.autoInstall, cachedOnly: config.cachedOnly, archivePassword: config.archivePassword || '', keepArchives: Boolean(config.keepArchives), transferTimeoutMinutes: config.transferTimeoutMinutes || 120, automaticUpdates: config.automaticUpdates !== false });

function readPalette(palette) {
  return Object.fromEntries(Object.entries(defaultPalette).map(([name, fallback]) => [
    name, typeof palette?.[name] === 'string' && /^#[0-9a-f]{6}$/i.test(palette[name]) ? palette[name] : fallback
  ]));
}

const configFile = () => path.join(dataDirectory(), 'config.json');
let themeStore;
const getThemeStore=()=>themeStore||(themeStore=new Themes(dataDirectory()));
let configQueue = Promise.resolve();

async function readConfig() {
  try {
    const config = JSON.parse(await fs.readFile(configFile(), 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid config.json. Expected an object.');
    return {
      ...config,
      onboardingCompleted: config.onboardingCompleted !== false,
      palette: readPalette(config.palette),
      downloadPath: typeof config.downloadPath === 'string' && path.isAbsolute(config.downloadPath) ? path.resolve(config.downloadPath) : path.join(app.getPath('downloads'), 'Mamba'),
      autoInstall: config.autoInstall !== false,
      keepArchives: config.keepArchives === true,
      automaticUpdates: config.automaticUpdates !== false,
      notifications:config.notifications!==false,
      preferredLanguage:['any','english','russian','spanish','french','german'].includes(config.preferredLanguage)?config.preferredLanguage:'english',
      preferredRelease:['any','repack','portable','original'].includes(config.preferredRelease)?config.preferredRelease:'any',
      librarySort:['name','recent','installed'].includes(config.librarySort)?config.librarySort:'name',
      libraryFavoritesOnly:config.libraryFavoritesOnly===true,
      cachedOnly: config.cachedOnly !== false,
      transferTimeoutMinutes: Math.max(5, Math.min(1440, Number(config.transferTimeoutMinutes) || 120)),
      torboxApiKey: typeof config.torboxApiKey === 'string' ? config.torboxApiKey : '',
      realDebridApiKey:typeof config.realDebridApiKey==='string'?config.realDebridApiKey:'',
      enabledDownloadServices:Array.isArray(config.enabledDownloadServices)?config.enabledDownloadServices.filter(id=>['torbox','realdebrid','direct'].includes(id)):['torbox','direct'],
      preferredDownloadService:['auto','torbox','realdebrid','direct'].includes(config.preferredDownloadService)?config.preferredDownloadService:'auto',
      disabledDownloadHosts:Array.isArray(config.disabledDownloadHosts)?config.disabledDownloadHosts.filter(host=>typeof host==='string'):[],
      disabledSourceUrls:Array.isArray(config.disabledSourceUrls)?config.disabledSourceUrls.filter(uri=>typeof uri==='string'):[],
      sourceUrls: Array.isArray(config.sourceUrls) ? config.sourceUrls.filter((url) => typeof url === 'string') : []
    };
  } catch (error) {
    if(error instanceof SyntaxError || error.message==='Invalid config.json. Expected an object.') {
      await fs.rename(configFile(),configFile()+'.invalid-'+Date.now()+'.backup');
      reportIssue(new Error('The settings file was unreadable. It was backed up and defaults were restored. Open Settings to reconnect TorBox and choose your Games folder.'),'config');
      return readConfig();
    }
    if (error.code !== 'ENOENT') throw error;
    // Preserve the existing API key when upgrading from encrypted storage.
    let torboxApiKey = '';
    try {
      const legacy = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'torbox-key.json'), 'utf8'));
      if (legacy.encryptedKey && safeStorage.isEncryptionAvailable()) {
        torboxApiKey = safeStorage.decryptString(Buffer.from(legacy.encryptedKey, 'base64'));
      }
    } catch (legacyError) {
      if (legacyError.code !== 'ENOENT') throw legacyError;
    }
    return { onboardingCompleted:false,notifications:true,preferredLanguage:'english',preferredRelease:'portable',librarySort:'name',libraryFavoritesOnly:false,torboxApiKey, sourceUrls: [], palette: { ...defaultPalette }, downloadPath: path.join(app.getPath('downloads'), 'Mamba'), autoInstall: true, cachedOnly: true, keepArchives: false, automaticUpdates: true, transferTimeoutMinutes: 120 };
  }
}

async function writeConfig(config) {
  const destination = configFile();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(`${destination}.tmp`, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await fs.rename(`${destination}.tmp`, destination);
}

function updateConfig(update) {
  const pending = configQueue.then(async () => {
    const config = await readConfig();
    await update(config);
    await writeConfig(config);
    await refreshBackgroundConfig();
    return { ...publicConfig(config), installedGames: installedGames };
  });
  configQueue = pending.catch(() => {});
  return pending;
}

ipcMain.handle('config:load', (_event, legacyUrls) => updateConfig(async (config) => {
  if (!config.legacyUrlsMigrated) {
    if (!config.torboxApiKey) {
      try {
        const legacy = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'torbox-key.json'), 'utf8'));
        if (legacy.encryptedKey && safeStorage.isEncryptionAvailable()) {
          config.torboxApiKey = safeStorage.decryptString(Buffer.from(legacy.encryptedKey, 'base64'));
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const previous = Array.isArray(legacyUrls) ? legacyUrls.filter((url) => typeof url === 'string') : [];
    config.sourceUrls = [...new Set([...config.sourceUrls, ...previous])];
    config.legacyUrlsMigrated = true;
  }
}));
ipcMain.handle('config:save', async (_event, settings) => {
  const saved = await updateConfig((config) => {
  if (!settings || !Array.isArray(settings.sourceUrls) || typeof settings.apiKey !== 'string') {
    throw new Error('Invalid settings.');
  }
  const urls = settings.sourceUrls.map((value) => {
    if (typeof value !== 'string') throw new Error('Invalid source URL.');
    const url = value.trim();
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Sources must be HTTP or HTTPS JSON URLs.');
    return url;
  });
  if (settings.apiKey.trim()) config.torboxApiKey = settings.apiKey.trim();
  if(typeof settings.realDebridApiKey==='string'&&settings.realDebridApiKey.trim())config.realDebridApiKey=settings.realDebridApiKey.trim();
  Object.assign(config,validateSettings(Object.fromEntries(['enabledDownloadServices','preferredDownloadService','disabledDownloadHosts','disabledSourceUrls'].filter(key=>settings[key]!==undefined).map(key=>[key,settings[key]]))));
  config.sourceUrls = [...new Set(urls)];
  if (settings.downloadPath !== undefined) {
    if (typeof settings.downloadPath !== 'string' || !path.isAbsolute(settings.downloadPath.trim())) throw new Error('Choose an absolute game folder path.');
    config.downloadPath = path.resolve(settings.downloadPath.trim());
  }
  if (typeof settings.autoInstall === 'boolean') config.autoInstall = settings.autoInstall;
  if (typeof settings.cachedOnly === 'boolean') config.cachedOnly = settings.cachedOnly;
  if (typeof settings.archivePassword === 'string') config.archivePassword = settings.archivePassword;
  Object.assign(config, validateSettings(Object.fromEntries(['keepArchives','transferTimeoutMinutes','automaticUpdates','palette','notifications','preferredLanguage','preferredRelease','appearance'].filter(key => settings[key] !== undefined).map(key => [key,settings[key]]))));
  });
  task('library:scan').catch(() => {});
  return saved;
});
ipcMain.handle('torbox:clear-key', () => updateConfig((config) => { config.torboxApiKey = ''; }));
ipcMain.handle('service:clear-key',(_event,id)=>{if(id!=='realdebrid')throw Error('Unknown service.');return updateConfig(config=>{config.realDebridApiKey='';});});
ipcMain.handle('catalog:download-options',()=>task('catalog:download-options'));
ipcMain.handle('themes:font',async event=>{const selected=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{filters:[{name:'Font',extensions:['ttf','otf','woff','woff2']}],properties:['openFile']});if(selected.canceled||!selected.filePaths[0])return null;const file=selected.filePaths[0];if((await fs.stat(file)).size>5*1024*1024)throw Error('Choose a font smaller than 5 MB.');const font={name:path.basename(file),data:(await fs.readFile(file)).toString('base64')};parseTheme({...require('./theme-model.js').presets[0],fonts:[font]});return font;});
ipcMain.handle('themes:list',()=>getThemeStore().list());
ipcMain.handle('themes:save',(_event,theme)=>getThemeStore().save(parseTheme(theme)));
ipcMain.handle('themes:export',async(event,value)=>{const theme=parseTheme(value);const filename=require('./lib/library.cjs').safeName(theme.name)+'.mamba-theme.json';const chosen=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{defaultPath:filename,filters:[{name:'Mamba theme',extensions:['json']}]});if(chosen.canceled||!chosen.filePath)return false;await fs.writeFile(chosen.filePath,JSON.stringify(theme,null,2)+'\n');return true;});
ipcMain.handle('themes:import',async event=>{const selected=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{filters:[{name:'Mamba theme',extensions:['json']}],properties:['openFile']});if(selected.canceled||!selected.filePaths[0])return null;const file=selected.filePaths[0];if((await fs.stat(file)).size>15*1024*1024)throw Error('Theme file is too large.');const theme=parseTheme(JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')));return getThemeStore().save(theme);});
ipcMain.handle('config:export', async event => {
  const chosen = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { defaultPath: 'Mamba-config.json', filters: [{name:'JSON settings',extensions:['json']}] });
  if (chosen.canceled || !chosen.filePath) return null;
  await fs.writeFile(chosen.filePath, encodeConfig(await readConfig(), app.getVersion()), { mode: 0o600 });
  return true;
});
ipcMain.handle('config:import', async event => {
  const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties:['openFile'], filters:[{name:'JSON settings',extensions:['json']}] });
  if (chosen.canceled || !chosen.filePaths.length) return null;
  if ((await fs.stat(chosen.filePaths[0])).size > 2*1024*1024) throw new Error('Config files must be smaller than 2 MB.');
  const imported = decodeConfig(await fs.readFile(chosen.filePaths[0], 'utf8'));
  const result = await updateConfig(async config => {
    await fs.writeFile(configFile()+'.backup-'+Date.now(),JSON.stringify(config,null,2)+'\n',{mode:0o600});
    Object.assign(config, imported, {legacyUrlsMigrated:true});
  });
  task('library:scan').catch(()=>{});
  return result;
});
ipcMain.handle('app:updates', () => ({...updates.state}));
ipcMain.handle('app:check-updates', () => updates.check(true));
ipcMain.handle('app:install-update', () => updates.install());

function broadcast(channel, data) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    try { window.webContents.send(channel, data); } catch { /* A window may close during delivery. */ }
  }
}
ipcMain.handle('catalog:status', () => catalogState);
ipcMain.handle('catalog:sync', () => task('catalog:sync', true));
ipcMain.handle('catalog:search', (_event, query, offset) => task('catalog:search', String(query || '').slice(0, 300), offset));
ipcMain.handle('catalog:resolve', (_event, id) => task('catalog:resolve', String(id)));
ipcMain.handle('catalog:artwork', (_event, id) => task('catalog:artwork', String(id)));
ipcMain.handle('home:featured', () => task('home:featured'));
ipcMain.handle('downloads:best', (_event, id) => task('downloads:best', String(id)));
ipcMain.handle('downloads:list', () => downloadJobs);
ipcMain.handle('downloads:start', (_event, id, option, game, service) => task('downloads:start', id, option, game, service));
ipcMain.handle('downloads:cancel', (_event, id) => task('downloads:cancel', id));
ipcMain.handle('downloads:retry', (_event, id) => task('downloads:retry', id));
ipcMain.handle('downloads:remove', (_event, id) => task('downloads:remove', String(id)));
ipcMain.handle('downloads:clear-finished', () => task('downloads:clear-finished'));
ipcMain.handle('library:scan', () => task('library:scan'));
ipcMain.handle('game:details', (_event,id)=>task('game:details',String(id)));
ipcMain.handle('downloads:pause', (_event,id)=>task('downloads:pause',String(id)));
ipcMain.handle('catalog:cancel', ()=>task('catalog:cancel'));
ipcMain.handle('library:favorite', (_event,id,value)=>task('library:favorite',String(id),!!value));
ipcMain.handle('config:view', (_event,view)=>updateConfig(config=>{
  if(view.librarySort!==undefined){if(!['name','recent','installed'].includes(view.librarySort))throw Error('Invalid library sort.');config.librarySort=view.librarySort;}
  if(view.libraryFavoritesOnly!==undefined)config.libraryFavoritesOnly=!!view.libraryFavoritesOnly;
}));
ipcMain.handle('storage:check', ()=>task('storage:check'));
ipcMain.handle('library:import', async event=>{
  const chosen=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Choose an existing game installation',properties:['openDirectory']});
  if(chosen.canceled||!chosen.filePaths[0])return null;
  return task('library:import',chosen.filePaths[0]);
});
ipcMain.handle('library:choose-launcher', async (event,id)=>{
  const game=await task('library:get',String(id));if(!game)throw Error('Game not found.');
  const chosen=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Choose the file that starts '+game.name,defaultPath:game.folder,properties:['openFile'],filters:[{name:'Game launchers',extensions:['exe','com','cmd','bat','ps1','lnk']}]});
  if(chosen.canceled||!chosen.filePaths[0])return null;
  return task('library:launcher',game.id,chosen.filePaths[0]);
});
ipcMain.handle('library:remove', async (event,id)=>{
  const game=await task('library:get',String(id));if(!game)throw Error('Game not found.');
  if(await task('library:busy',game.id))throw Error('Finish or cancel the active download before removing this installation.');
  if(downloadJobs.some(job=>job.folder===game.folder&&['preparing','downloading','extracting','installing'].includes(job.status)))throw Error('Finish or cancel the active download before removing this installation.');
  const config=await readConfig();authorizeGame(config,game.imported?[game.folder]:[],game);
  if(game.imported)return task('library:forget',game.folder);
  const selected=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'warning',title:'Uninstall '+game.name+'?',message:'Move this installation to the Recycle Bin?',detail:game.folder+'\n\nOther installations will remain. Saved games outside this folder are not removed. Steam and Xbox shortcuts may need to be removed from those apps.',buttons:['Keep game','Uninstall'],defaultId:0,cancelId:0,noLink:true});
  if(selected.response!==1)return false;
  if((await fs.lstat(game.folder)).isSymbolicLink())throw Error('The game folder changed. Refresh the library.');
  await shell.trashItem(game.folder);await task('library:scan');return true;
});
function activityStatus(){return {version:app.getVersion(),worker:{connected:!!background?.child,pid:background?.child?.pid||null,pending:background?.pending.size||0,lastHeartbeat:background?.lastHeartbeat||null},catalog:{phase:catalogState.phase,count:catalogState.count||0,unavailableSources:catalogState.errors?.length||0,message:catalogState.message},libraryCount:installedGames.length,jobs:downloadJobs,issues:issues.items};}
ipcMain.handle('app:activity',()=>activityStatus());
ipcMain.handle('issues:resolve',(_event,id)=>{issues.resolve(String(id));broadcast('issues:changed',issues.items);issueQueue=issueQueue.catch(()=>{}).then(()=>fs.writeFile(path.join(dataDirectory(),'issues.json'),JSON.stringify(issues.items))).catch(()=>{});return true;});
ipcMain.handle('issues:report',(_event,message)=>reportIssue(new Error(String(message).slice(0,700)),'interface'));
ipcMain.handle('background:restart',async event=>{
  if(downloadJobs.some(job=>['extracting','installing'].includes(job.status)))throw Error('Wait for extraction or installation to finish before restarting background tasks.');
  if(downloadJobs.some(job=>['queued','preparing','downloading'].includes(job.status))){const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'question',message:'Restart background tasks?',detail:'Active downloads will pause. Resume them after the service reconnects.',buttons:['Keep running','Restart tasks'],defaultId:0,cancelId:0});if(answer.response!==1)return false;}
  await background.restart();return true;
});
ipcMain.handle('app:export-diagnostics',async event=>{
  const chosen=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{defaultPath:'Mamba-diagnostics.json',filters:[{name:'Diagnostics',extensions:['json']}]});
  if(chosen.canceled||!chosen.filePath)return false;
  const status=activityStatus();
  const report={schemaVersion:1,createdAt:new Date().toISOString(),version:status.version,platform:process.platform,architecture:process.arch,electron:process.versions.electron,worker:{connected:status.worker.connected,pending:status.worker.pending},catalog:{phase:status.catalog.phase,count:status.catalog.count,unavailableSources:status.catalog.unavailableSources},libraryCount:status.libraryCount,tasks:downloadJobs.map(({status,stage,progress,total,received,message,downloadFailure})=>({status,stage,progress,total,received,message:safeMessage(message,configSecrets),downloadFailure})),issues:issues.diagnostics()};
  await fs.writeFile(chosen.filePath,JSON.stringify(report,null,2),'utf8');return true;
});
ipcMain.handle('library:action', async (_event, id, action) => {
  const game = await task('library:get', id);
  if (!game) throw new Error('Game not found. Refresh your library.');
  const config = await readConfig();
  authorizeGame(config,game.imported?[game.folder]:[],game);
  if (action === 'launcher') { await openGameHelper(game.folder); return; }
  if (action === 'folder') { const error = await shell.openPath(game.folder); if (error) throw new Error(error); return; }
  const target = action === 'setup' ? game.installer : action === 'play' && game.status === 'installed' ? game.executable : null;
  if (!target) throw new Error('No executable was detected. Open the game folder to finish setup.');
  within(game.folder, target);
  if (!(await fs.lstat(target)).isFile()) throw new Error('The executable is no longer available.');
  if (action === 'setup') { const error = await shell.openPath(target); if (error) throw new Error(error); return; }
  if (!/\.(exe|com)$/i.test(target)) { const error = await shell.openPath(target); if (error) throw new Error(error); await task('library:played',id).catch(()=>{}); return; }
  await new Promise((resolve, reject) => {
    const child = spawn(target, [], { cwd: path.dirname(target), detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
  await task('library:played',id);
});
ipcMain.handle('folder:choose', async (event) => {
  const config = await readConfig();
  const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { defaultPath: config.downloadPath, properties: ['openDirectory', 'createDirectory'] });
  return chosen.canceled ? null : chosen.filePaths[0];
});
let tray = null;
function restoreWindow() { const window=BrowserWindow.getAllWindows()[0];if(window){window.show();if(window.isMinimized())window.restore();window.focus();} }
ipcMain.handle('onboarding:complete', () => updateConfig(config => { config.onboardingCompleted=true; }));
ipcMain.handle('app:test-restart', async (_event, firstRun) => {
  if(typeof firstRun!=='boolean')throw Error('Invalid restart option.');
  if(firstRun)await updateConfig(config=>{config.onboardingCompleted=false;});
  else await configQueue;
  app.relaunch();app.quit();
});
ipcMain.handle('window:minimize', (event) => { const window=BrowserWindow.fromWebContents(event.sender);if(tray)window?.hide();else window?.minimize(); });
ipcMain.handle('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
  return window.isMaximized();
});
ipcMain.handle('window:is-maximized', (event) => Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized()));
ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 400,
    minHeight: 300,
    title: 'Mamba · TorBox',
    icon: path.join(__dirname,'assets','mamba.ico'),
    backgroundColor: defaultPalette.primary,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.setMenuBarVisibility(false);
  window.on('minimize', event => { if(tray&&!closing){event.preventDefault();window.hide();} });
  window.on('close', event => { if(tray&&!closing){event.preventDefault();window.hide();} });
  const notifyWindowState = () => window.webContents.send('window:maximized', window.isMaximized());
  window.on('maximize', notifyWindowState);
  window.on('unmaximize', notifyWindowState);
  let rendererRestarts = [];
  window.webContents.on('render-process-gone', (_event, details) => {
    if (closing || details.reason === 'clean-exit' || window.isDestroyed()) return;
    const now = Date.now(); rendererRestarts = rendererRestarts.filter(at => now - at < 60000);
    fs.appendFile(path.join(dataDirectory(),'background-crashes.log'),new Date().toISOString()+' window exit '+details.reason+'\n').catch(()=>{});
    if (rendererRestarts.length >= 2) {
      dialog.showErrorBox('Mamba window stopped', 'The window could not recover. Restart Mamba. Background downloads are still handled separately.');
      return;
    }
    rendererRestarts.push(now);
    window.loadFile(path.join(__dirname, 'index.html')).catch(() => {});
  });
  window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  if(process.platform==='win32')app.setAppUserModelId('com.mamba.launcher');
  app.setAboutPanelOptions({applicationName:'Mamba',applicationVersion:app.getVersion(),iconPath:brandIcon});
  updates = new Updates(require('electron-updater').autoUpdater, { version:app.getVersion(), packaged:app.isPackaged, getConfig:readConfig, canInstall:()=>!downloadJobs.some(job=>['queued','preparing','downloading','extracting','installing'].includes(job.status)) });
  updates.on('change',state=>broadcast('app:updated',state));
  background = new BackgroundClient(() => utilityProcess.fork(path.join(__dirname, 'background.cjs'), [], {
    serviceName: 'Mamba Background Tasks', stdio: 'ignore'
  }), {initialize:{directory:dataDirectory(), config:await readConfig(), resourcesPath:process.resourcesPath}});
  background.on('catalog:changed', state => { catalogState = state; broadcast('catalog:changed', state);if(state.phase==='error')reportIssue(new Error(state.message),'catalog:sync'); });
  background.on('library:changed', games => { installedGames = games; broadcast('library:changed', games); });
  const previousStatuses=new Map();
  background.on('downloads:changed', jobs => {
    for(const job of jobs){
      const previous=previousStatuses.get(job.id);
      if(previous && previous!==job.status && ['completed','needs-setup','failed'].includes(job.status)) {
        if(job.status==='failed')reportIssue(new Error(job.message),'downloads');
        const readyGame=job.status==='completed'?installedGames.find(game=>game.folder&&job.folder&&path.resolve(game.folder).toLowerCase()===path.resolve(job.folder).toLowerCase()):null;
        broadcast('app:notice',{jobId:job.id,gameId:job.gameId,libraryId:readyGame?.id||null,folder:job.folder,name:job.name,status:job.status});
        if(background.options.initialize.config.notifications!==false && Notification.isSupported()) {
          try { const notice=new Notification({icon:brandIcon,title:job.status==='completed'?'Ready to play':job.status==='needs-setup'?'Installation needs review':'Download needs attention',body:job.name});
          notice.on('error',()=>{});notice.on('click',()=>{const window=BrowserWindow.getAllWindows()[0];if(!window)return;window.show();if(window.isMinimized())window.restore();window.focus();broadcast('app:navigate',{id:job.gameId,folder:job.folder,page:job.status==='failed'?'activity':'game'});});notice.show(); } catch { /* In-app notices remain available if Windows blocks notifications. */ }
        }
      }
      previousStatuses.set(job.id,job.status);
    }
    downloadJobs=jobs;broadcast('downloads:changed',jobs);
  });
  background.on('service:issue',issue=>reportIssue(new Error(issue.message),issue.context));
  background.on('interrupted', ({code}) => {
    downloadJobs = downloadJobs.map(job => ['queued','preparing','downloading','extracting','installing'].includes(job.status) ? {...job,status:'paused',speed:0,message:'Background service interrupted. Retry after it reconnects.'} : job);
    broadcast('downloads:changed', downloadJobs);
    reportIssue(new Error('The background service stopped. Unfinished downloads are paused.'),'background');
    catalogState = {...catalogState,phase:'interrupted',message:'Background service restarting. Unfinished tasks are paused.'};
    broadcast('catalog:changed',catalogState);
    // Log the exit code only; never write API keys, request payloads or download URLs.
    fs.appendFile(path.join(dataDirectory(),'background-crashes.log'),new Date().toISOString()+' background exit '+String(code)+'\n').catch(()=>{});
  });
  background.on('unavailable', () => {
    catalogState = {...catalogState,phase:'error',message:'Background service could not recover. Restart Mamba.'};
    broadcast('catalog:changed',catalogState);
  });
  configSecrets=[background.options.initialize.config.torboxApiKey,background.options.initialize.config.realDebridApiKey,background.options.initialize.config.archivePassword];
  try{const saved=JSON.parse(await fs.readFile(path.join(dataDirectory(),'issues.json'),'utf8'));if(Array.isArray(saved))issues.items=saved.slice(0,50);}catch{}
  try { tray=new Tray(path.join(__dirname,'assets','mamba.ico'));tray.setToolTip('Mamba — running in the background');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Mamba',click:restoreWindow},{type:'separator'},{label:'Quit Mamba',click:()=>app.quit()}]));tray.on('double-click',restoreWindow);tray.on('click',restoreWindow); } catch { tray=null; }
  createWindow();
  await registerHelperRuntime();
  background.start().catch(() => {});
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  configWatcher = require('node:fs').watch(path.dirname(configFile()), (_type, filename) => {
    if (String(filename) !== 'config.json') return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => refreshBackgroundConfig().catch(() => {}), 1000);
  });
  configWatcher.on('error', () => {});
  updates.start();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  dialog.showErrorBox('Mamba could not start', 'Check your config.json and games folder. '+error.message);
  app.quit();
});
let closing = false;
app.on('before-quit', event => {
  if (closing) return;
  closing = true; event.preventDefault();
  updates?.stop(); clearTimeout(watchTimer); configWatcher?.close();
  Promise.resolve(background?.close()).catch(()=>{}).finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
