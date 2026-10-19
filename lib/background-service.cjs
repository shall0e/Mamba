const fs = require('node:fs/promises');
const path = require('node:path');
const { Catalog } = require('./catalog.cjs');
const { Library, finalizeInstallation, atomicJson } = require('./library.cjs');
const { Downloads } = require('./downloads.cjs');
const { Metadata } = require('./metadata.cjs');
const { GameIdentity } = require('./game-identity.cjs');
const { Artwork } = require('./artwork.cjs');
const { registerSteam } = require('./shortcuts.cjs');
const { registerXbox } = require('./xbox.cjs');
const { openGameHelper } = require('./game-helper.cjs');
const { addGame } = require('../tools/add-game.cjs');

class BackgroundService {
  constructor(emit) { this.emit = emit; this.stopping = false; }
  async initialize({ directory, config, resourcesPath }) {
    this.directory = directory; this.config = config;
    if (resourcesPath) process.env.MAMBA_RESOURCES_PATH = resourcesPath;
    const getConfig = async () => this.config;
    this.catalog = new Catalog(directory, getConfig);
    this.metadata = new Metadata(directory, this.catalog);
    this.identity = new GameIdentity(directory);
    this.library = new Library(getConfig, { identify: (name, hints) => this.identity.identify(name, hints), repair: async ({folder, manifest}) => {
      if (this.downloads.jobs.some(job => job.folder === folder && this.downloads.controllers.has(job.id))) return null;
      const name = await this.metadata.resolveName(manifest.name);
      const result = await finalizeInstallation(folder, name, { releaseId: manifest.releaseId, status: 'installed' });
      await addGame({ name, file: result.executable, folder: result.folder, xbox: game => this.addXboxGame(game) });
      result.manifest = JSON.parse(await fs.readFile(path.join(result.folder, '.mamba-game.json'), 'utf8'));
      for (const job of this.downloads.jobs.filter(job => job.folder === folder)) await this.downloads.update(job, { folder: result.folder, name, status: 'completed', message: 'Ready to play' });
      return result;
    }});
    this.catalog.library = this.library;
    this.artwork = new Artwork(directory, this.catalog);
    this.downloads = new Downloads(directory, getConfig, this.catalog, this.library, {
      resolveName: name => this.metadata.resolveName(name), registerGame: registerSteam,
      registerXbox: game => this.addXboxGame(game),
      setupGame: game => addGame({ ...game, resolveName: name => this.metadata.resolveName(name), xbox: value => this.addXboxGame(value) }),
      reviewSetup: openGameHelper
    });
    // Any completed scan, including post-download scans, updates the UI once.
    const scan = this.library.scan.bind(this.library);
    this.library.scan = () => {
      if (this.scanPending) return this.scanPending;
      this.scanPending = scan().then(items => { this.emit('library:changed', items); return items; }).finally(() => { this.scanPending = null; });
      return this.scanPending;
    };
    this.catalog.on('status', state => this.emit('catalog:changed', state));
    this.downloads.on('change', jobs => this.emit('downloads:changed', jobs));
    await this.catalog.load(); await this.metadata.load(); await this.identity.load(); await this.downloads.load();
    this.emit('downloads:changed', this.downloads.snapshot());
    this.emit('catalog:changed', this.catalog.state);
    this.library.scan().then(() => this.syncXboxLibrary()).catch(() => {});
    this.catalog.sync().catch(() => {});
    this.timer = setInterval(() => this.maintenance().catch(() => {}), 30000);
    return true;
  }
  async addXboxGame(game) {
    const group = this.catalog.searchIndex?.find(entry => entry.name === game.name);
    const image = await this.artwork.get(group?.id || game.id).catch(() => null);
    return registerXbox({ ...game, image });
  }
  async syncXboxLibrary() {
    for (const game of this.library.items) {
      if (this.stopping || !game.executable || game.status !== 'installed') continue;
      const file = path.join(game.folder, '.mamba-game.json');
      try {
        const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!manifest.name || manifest.xbox?.status === 'added') continue;
        const xbox = await this.addXboxGame(game).catch(error => ({status:'pending',message:error.message}));
        await atomicJson(file, {...manifest, xbox});
      } catch { /* An unreadable installation must not stop the rest. */ }
    }
  }
  async maintenance() {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      if (this.library.items.some(game => game.repairPending)) await this.library.scan();
      await this.syncXboxLibrary();
      for (const game of this.library.items) {
        if (this.stopping) break;
        try {
          const file = path.join(game.folder, '.mamba-game.json');
          const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
          if (manifest.steam?.status !== 'pending' || !game.executable) continue;
          const steam = await registerSteam(game).catch(error => ({status:'pending',message:error.message}));
          await atomicJson(file, {...manifest, steam});
        } catch {}
      }
    } finally { this.busy = false; }
  }
  async call(method, args = []) {
    switch (method) {
      case 'initialize': return this.initialize(args);
      case 'configure': this.config = args[0]; return true;
      case 'catalog:sync': this.catalog.sync(args[0]).catch(() => {}); return this.catalog.state;
      case 'catalog:search': return this.metadata.search(...args);
      case 'catalog:resolve': return this.catalog.resolveGame(...args);
      case 'catalog:artwork': return this.artwork.get(...args);
      case 'downloads:best': return this.downloads.startBest(...args);
      case 'downloads:start': return this.downloads.start(...args);
      case 'downloads:cancel': return this.downloads.cancel(...args);
      case 'downloads:retry': return this.downloads.retry(...args);
      case 'downloads:remove': return this.downloads.remove(...args);
      case 'downloads:clear-finished': return this.downloads.clearFinished();
      case 'library:scan': return this.library.scan();
      case 'library:get': return this.library.get(...args);
      case 'shutdown':
        this.stopping = true; clearInterval(this.timer); clearTimeout(this.catalog?.retryTimer);
        this.catalog?.controller?.abort(); this.downloads?.stop();
        await this.downloads?.persist(); return true;
      default: throw new Error('Unknown background task.');
    }
  }
}
module.exports = { BackgroundService };
