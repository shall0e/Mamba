const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, utilityProcess } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const defaultPalette = require('./palette-defaults.json');
const { within } = require('./lib/library.cjs');
const { registerHelperRuntime, openGameHelper } = require('./lib/game-helper.cjs');
const { validateSettings, decodeConfig, encodeConfig } = require('./lib/config-transfer.cjs');
const { Updates } = require('./lib/updates.cjs');
const { BackgroundClient } = require('./lib/background-client.cjs');
const { spawn } = require('node:child_process');
let updates, background, configWatcher, watchTimer, resolvedDataDirectory;
let installedGames = [], downloadJobs = [];
let catalogState = { phase: 'loading', message: 'Starting background service…', count: 0, errors: [] };
function task(method, ...args) {
  if (!background) return Promise.reject(new Error('Mamba is starting. Try again shortly.'));
  return background.request(method, ...args);
}
async function refreshBackgroundConfig() {
  if (!background) return;
  const config = await readConfig();
  background.options.initialize.config = config;
  await task('configure', config);
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
const publicConfig = (config) => ({ configured: Boolean(config.torboxApiKey), sourceUrls: config.sourceUrls, palette: config.palette, downloadPath: config.downloadPath, autoInstall: config.autoInstall, cachedOnly: config.cachedOnly, archivePassword: config.archivePassword || '', keepArchives: Boolean(config.keepArchives), transferTimeoutMinutes: config.transferTimeoutMinutes || 120, automaticUpdates: config.automaticUpdates !== false });

function readPalette(palette) {
  return Object.fromEntries(Object.entries(defaultPalette).map(([name, fallback]) => [
    name, typeof palette?.[name] === 'string' && /^#[0-9a-f]{6}$/i.test(palette[name]) ? palette[name] : fallback
  ]));
}

const configFile = () => path.join(dataDirectory(), 'config.json');
let configQueue = Promise.resolve();

async function readConfig() {
  try {
    const config = JSON.parse(await fs.readFile(configFile(), 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid config.json. Expected an object.');
    return {
      ...config,
      palette: readPalette(config.palette),
      downloadPath: typeof config.downloadPath === 'string' && path.isAbsolute(config.downloadPath) ? path.resolve(config.downloadPath) : path.join(app.getPath('downloads'), 'Mamba'),
      autoInstall: config.autoInstall !== false,
      keepArchives: config.keepArchives === true,
      automaticUpdates: config.automaticUpdates !== false,
      cachedOnly: config.cachedOnly !== false,
      transferTimeoutMinutes: Math.max(5, Math.min(1440, Number(config.transferTimeoutMinutes) || 120)),
      torboxApiKey: typeof config.torboxApiKey === 'string' ? config.torboxApiKey : '',
      sourceUrls: Array.isArray(config.sourceUrls) ? config.sourceUrls.filter((url) => typeof url === 'string') : []
    };
  } catch (error) {
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
    return { torboxApiKey, sourceUrls: [], palette: { ...defaultPalette }, downloadPath: path.join(app.getPath('downloads'), 'Mamba'), autoInstall: true, cachedOnly: true, keepArchives: false, automaticUpdates: true, transferTimeoutMinutes: 120 };
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
  config.sourceUrls = [...new Set(urls)];
  if (settings.downloadPath !== undefined) {
    if (typeof settings.downloadPath !== 'string' || !path.isAbsolute(settings.downloadPath.trim())) throw new Error('Choose an absolute game folder path.');
    config.downloadPath = path.resolve(settings.downloadPath.trim());
  }
  if (typeof settings.autoInstall === 'boolean') config.autoInstall = settings.autoInstall;
  if (typeof settings.cachedOnly === 'boolean') config.cachedOnly = settings.cachedOnly;
  if (typeof settings.archivePassword === 'string') config.archivePassword = settings.archivePassword;
  Object.assign(config, validateSettings(Object.fromEntries(['keepArchives','transferTimeoutMinutes','automaticUpdates','palette'].filter(key => settings[key] !== undefined).map(key => [key,settings[key]]))));
  });
  task('library:scan').catch(() => {});
  return saved;
});
ipcMain.handle('torbox:clear-key', () => updateConfig((config) => { config.torboxApiKey = ''; }));
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
ipcMain.handle('downloads:best', (_event, id) => task('downloads:best', String(id)));
ipcMain.handle('downloads:list', () => downloadJobs);
ipcMain.handle('downloads:start', (_event, id, option) => task('downloads:start', id, option));
ipcMain.handle('downloads:cancel', (_event, id) => task('downloads:cancel', id));
ipcMain.handle('downloads:retry', (_event, id) => task('downloads:retry', id));
ipcMain.handle('downloads:remove', (_event, id) => task('downloads:remove', String(id)));
ipcMain.handle('downloads:clear-finished', () => task('downloads:clear-finished'));
ipcMain.handle('library:scan', () => task('library:scan'));
ipcMain.handle('library:action', async (_event, id, action) => {
  const game = await task('library:get', id);
  if (!game) throw new Error('Game not found. Refresh your library.');
  const config = await readConfig();
  within(config.downloadPath, game.folder);
  if (action === 'launcher') { await openGameHelper(game.folder); return; }
  if (action === 'folder') { const error = await shell.openPath(game.folder); if (error) throw new Error(error); return; }
  const target = action === 'setup' ? game.installer : action === 'play' && game.status === 'installed' ? game.executable : null;
  if (!target) throw new Error('No executable was detected. Open the game folder to finish setup.');
  within(game.folder, target);
  if (!(await fs.lstat(target)).isFile()) throw new Error('The executable is no longer available.');
  if (action === 'setup') { const error = await shell.openPath(target); if (error) throw new Error(error); return; }
  if (!/\.(exe|com)$/i.test(target)) { const error = await shell.openPath(target); if (error) throw new Error(error); return; }
  await new Promise((resolve, reject) => {
    const child = spawn(target, [], { cwd: path.dirname(target), detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
});
ipcMain.handle('folder:choose', async (event) => {
  const config = await readConfig();
  const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { defaultPath: config.downloadPath, properties: ['openDirectory', 'createDirectory'] });
  return chosen.canceled ? null : chosen.filePaths[0];
});
ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
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
  updates = new Updates(require('electron-updater').autoUpdater, { version:app.getVersion(), packaged:app.isPackaged, getConfig:readConfig, canInstall:()=>!downloadJobs.some(job=>['queued','preparing','downloading','extracting','installing'].includes(job.status)) });
  updates.on('change',state=>broadcast('app:updated',state));
  background = new BackgroundClient(() => utilityProcess.fork(path.join(__dirname, 'background.cjs'), [], {
    serviceName: 'Mamba Background Tasks', stdio: 'ignore'
  }), {initialize:{directory:dataDirectory(), config:await readConfig(), resourcesPath:process.resourcesPath}});
  background.on('catalog:changed', state => { catalogState = state; broadcast('catalog:changed', state); });
  background.on('library:changed', games => { installedGames = games; broadcast('library:changed', games); });
  background.on('downloads:changed', jobs => { downloadJobs = jobs; broadcast('downloads:changed', jobs); });
  background.on('interrupted', ({code}) => {
    downloadJobs = downloadJobs.map(job => ['queued','preparing','downloading','extracting','installing'].includes(job.status) ? {...job,status:'paused',speed:0,message:'Background service interrupted. Retry after it reconnects.'} : job);
    broadcast('downloads:changed', downloadJobs);
    catalogState = {...catalogState,phase:'interrupted',message:'Background service restarting. Unfinished tasks are paused.'};
    broadcast('catalog:changed',catalogState);
    // Log the exit code only; never write API keys, request payloads or download URLs.
    fs.appendFile(path.join(dataDirectory(),'background-crashes.log'),new Date().toISOString()+' background exit '+String(code)+'\n').catch(()=>{});
  });
  background.on('unavailable', () => {
    catalogState = {...catalogState,phase:'error',message:'Background service could not recover. Restart Mamba.'};
    broadcast('catalog:changed',catalogState);
  });
  createWindow();
  await registerHelperRuntime();
  background.start().catch(() => {});
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  configWatcher = require('node:fs').watch(path.dirname(configFile()), (_type, filename) => {
    if (String(filename) !== 'config.json') return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => refreshBackgroundConfig().then(() => task('catalog:sync')).catch(() => {}), 1000);
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
  Promise.resolve(background?.close()).finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
