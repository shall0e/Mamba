const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const defaultPalette = require('./palette-defaults.json');
const { Catalog } = require('./lib/catalog.cjs');
const { Library, within, finalizeInstallation, atomicJson } = require('./lib/library.cjs');
const { registerSteam } = require('./lib/shortcuts.cjs');
const { Downloads } = require('./lib/downloads.cjs');
const { Artwork } = require('./lib/artwork.cjs');
const { Metadata } = require('./lib/metadata.cjs');
const { spawn } = require('node:child_process');
let catalog, library, downloads, artwork, metadata, configWatcher, watchTimer, steamTimer, resolvedDataDirectory;
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
  return resolvedDataDirectory = app.getPath('userData');
}
const publicConfig = (config) => ({ configured: Boolean(config.torboxApiKey), sourceUrls: config.sourceUrls, palette: config.palette, downloadPath: config.downloadPath, autoInstall: config.autoInstall, cachedOnly: config.cachedOnly, archivePassword: config.archivePassword || '' });

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
    return { torboxApiKey, sourceUrls: [], palette: { ...defaultPalette }, downloadPath: path.join(app.getPath('downloads'), 'Mamba'), autoInstall: true, cachedOnly: true, transferTimeoutMinutes: 120 };
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
    return { ...publicConfig(config), installedGames: library?.items || [] };
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
  });
  library?.scan().then((games) => broadcast('library:changed', games)).catch(() => {});
  return saved;
});
ipcMain.handle('torbox:clear-key', () => updateConfig((config) => { config.torboxApiKey = ''; }));

function broadcast(channel, data) {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, data);
}
ipcMain.handle('catalog:status', () => catalog?.state);
ipcMain.handle('catalog:sync', () => { catalog.sync(true).catch(() => {}); return catalog.state; });
ipcMain.handle('catalog:search', (_event, query, offset) => metadata.search(String(query || '').slice(0, 300), offset));
ipcMain.handle('catalog:resolve', (_event, id) => catalog.resolveGame(String(id)));
ipcMain.handle('catalog:artwork', (_event, id) => artwork.get(String(id)));
ipcMain.handle('downloads:best', (_event, id) => downloads.startBest(String(id)));
ipcMain.handle('downloads:list', () => downloads.snapshot());
ipcMain.handle('downloads:start', (_event, id, option) => downloads.start(id, option));
ipcMain.handle('downloads:cancel', (_event, id) => downloads.cancel(id));
ipcMain.handle('downloads:retry', (_event, id) => downloads.retry(id));
ipcMain.handle('downloads:remove', (_event, id) => downloads.remove(String(id)));
ipcMain.handle('downloads:clear-finished', () => downloads.clearFinished());
ipcMain.handle('library:scan', async () => { const games = await library.scan(); broadcast('library:changed', games); return games; });
ipcMain.handle('library:action', async (_event, id, action) => {
  const game = library.get(id);
  if (!game) throw new Error('Game not found. Refresh your library.');
  const config = await readConfig();
  within(config.downloadPath, game.folder);
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
  window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  catalog = new Catalog(dataDirectory(), readConfig);
  library = new Library(readConfig, { repair: async ({ folder, manifest }) => {
    if (downloads.jobs.some(job => job.folder === folder && downloads.controllers.has(job.id))) return null;
    const name = await metadata.resolveName(manifest.name);
    const result = await finalizeInstallation(folder, name, { releaseId: manifest.releaseId, status: 'installed' });
    const steam = await registerSteam({ name, executable: result.executable, folder: result.folder }).catch(error => ({ status: 'pending', message: error.message }));
    result.manifest.steam = steam;
    await atomicJson(path.join(result.folder, '.mamba-game.json'), result.manifest);
    for (const job of downloads.jobs.filter(job => job.folder === folder)) await downloads.update(job, { folder: result.folder, name, status: 'completed', message: 'Ready to play' });
    return result;
  } });
  downloads = new Downloads(dataDirectory(), readConfig, catalog, library, { resolveName: name => metadata.resolveName(name), registerGame: registerSteam });
  artwork = new Artwork(dataDirectory(), catalog);
  catalog.on('status', (state) => broadcast('catalog:changed', state));
  let lastLibrary = '';
  downloads.on('change', (jobs) => {
    broadcast('downloads:changed', jobs);
    const snapshot = JSON.stringify(library.items);
    if (snapshot !== lastLibrary) { lastLibrary = snapshot; broadcast('library:changed', library.items); }
  });
  await catalog.load();
  metadata = new Metadata(dataDirectory(), catalog);
  await metadata.load();
  await downloads.load();
  await library.scan().catch(() => {});
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  configWatcher = require('node:fs').watch(path.dirname(configFile()), (_type, filename) => {
    if (String(filename) !== 'config.json') return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => catalog.sync().catch(() => {}), 1000);
  });
  createWindow();
  let steamBusy = false;
  steamTimer = setInterval(async () => {
    if (steamBusy) return;
    steamBusy = true;
    try {
      if (library.items.some(game => game.repairPending)) {
        await library.scan(); broadcast('library:changed', library.items);
      }
      for (const game of library.items) {
        const file = path.join(game.folder, '.mamba-game.json');
        const manifest = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
        if (manifest.steam?.status !== 'pending' || !game.executable) continue;
        const steam = await registerSteam(game).catch(error => ({ status: 'pending', message: error.message }));
        await atomicJson(file, { ...manifest, steam });
      }
    } catch {} finally { steamBusy = false; }
  }, 30000);
  catalog.sync().catch(() => {});
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('before-quit', () => { clearInterval(steamTimer); clearTimeout(watchTimer); clearTimeout(catalog?.retryTimer); configWatcher?.close(); catalog?.controller?.abort(); downloads?.stop(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

