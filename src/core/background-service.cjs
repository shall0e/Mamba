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
const { SteamSearch } = require('./steam-search.cjs');
const { SteamFeatured } = require('./steam-featured.cjs');
const { FileCleanup } = require('./file-cleanup.cjs');
const { addGame } = require('../../tools/add-game.cjs');
const { LibraryState, sizeBytes, storageInfo, authorizeGame } = require('./experience.cjs');
const { desktopShortcut } = require('./shortcuts.cjs');

class BackgroundService {
  constructor(emit) {
    this.emit = emit;
    this.stopping = false;
  }
  async initialize({ directory, config, resourcesPath }) {
    this.directory = directory;
    this.config = config;
    if (resourcesPath) process.env.MAMBA_RESOURCES_PATH = resourcesPath;
    const getConfig = async () => this.config;
    this.libraryState = new LibraryState(directory);
    await this.libraryState.load();
    this.catalog = new Catalog(directory, getConfig);
    this.metadata = new Metadata(directory, this.catalog);
    this.identity = new GameIdentity(directory);
    this.steamFeatured = new SteamFeatured(this.identity);
    this.library = new Library(getConfig, {
      imports: () => this.libraryState.data.imports,
      identify: (name, hints) => this.identity.identify(name, hints),
      repair: async ({ folder, manifest }) => {
        if (
          this.downloads.jobs.some(
            (job) => job.folder === folder && this.downloads.controllers.has(job.id),
          )
        )
          return null;
        const name = await this.metadata.resolveName(manifest.name);
        const result = await finalizeInstallation(folder, name, {
          releaseId: manifest.releaseId,
          status: 'installed',
        });
        await addGame({
          name,
          file: result.executable,
          folder: result.folder,
          xbox: (game) => this.addXboxGame(game),
        });
        result.manifest = JSON.parse(
          await fs.readFile(path.join(result.folder, '.mamba-game.json'), 'utf8'),
        );
        for (const job of this.downloads.jobs.filter((job) => job.folder === folder))
          await this.downloads.update(job, {
            folder: result.folder,
            name,
            status: 'completed',
            message: 'Ready to play',
          });
        return result;
      },
    });
    this.catalog.library = this.library;
    this.artwork = new Artwork(directory, this.catalog);
    this.downloads = new Downloads(directory, getConfig, this.catalog, this.library, {
      resolveName: (name) => this.metadata.resolveName(name),
      registerGame: registerSteam,
      registerXbox: (game) => this.addXboxGame(game),
      setupGame: (game) =>
        addGame({
          ...game,
          resolveName: (name) => this.metadata.resolveName(name),
          xbox: (value) => this.addXboxGame(value),
        }),
      reviewSetup: openGameHelper,
    });

    this.cleanup = new FileCleanup({
      root: () => this.config.downloadPath,
      games: () => this.library.installations || this.library.items || [],
      jobs: () => this.downloads.jobs,
    });
    const scan = this.library.scan.bind(this.library);
    this.library.scan = () => {
      if (this.scanPending) return this.scanPending;
      this.scanPending = scan()
        .then((items) => {
          this.library.items = this.libraryState.decorate(items);
          this.emit('library:changed', this.library.items);
          return this.library.items;
        })
        .finally(() => {
          this.scanPending = null;
        });
      return this.scanPending;
    };
    this.catalog.on('status', (state) => this.emit('catalog:changed', state));
    this.downloads.on('change', (jobs) => this.emit('downloads:changed', jobs));
    this.downloads.on('failure', (error) =>
      this.emit('service:issue', { context: 'downloads', message: error.message }),
    );
    await this.catalog.load();
    await this.metadata.load();
    await this.identity.load();
    this.steamSearch = new SteamSearch(directory, this.catalog, this.identity);
    await this.steamSearch.load();
    this.catalog.steamSearch = this.steamSearch;
    this.steamSearch.onResults = (query, result) => this.emit('catalog:results', { query, result });
    await this.downloads.load();
    await this.downloads.clearStalePartials();
    if (this.downloads.loadWarning)
      this.emit('service:issue', { context: 'downloads', message: this.downloads.loadWarning });
    if (this.libraryState.recovered)
      this.emit('service:issue', {
        context: 'library',
        message:
          'Library preferences were unreadable. A backup was kept and favorites and play history were reset. Installed game files were not changed.',
      });
    this.emit('downloads:changed', this.downloads.snapshot());
    this.emit('catalog:changed', this.catalog.state);
    this.library
      .scan()
      .then(() => this.syncXboxLibrary())
      .catch((error) =>
        this.emit('service:issue', { context: 'library:scan', message: error.message }),
      );
    this.catalog.sync().catch(() => {});
    this.timer = setInterval(() => this.maintenance().catch(() => {}), 30000);
    return true;
  }
  async gameDetails(id) {
    const installed =
      this.library.get(id) ||
      this.library.items.find(
        (game) =>
          game.releaseId === id || game.installations?.some((item) => item.releaseId === id),
      );
    const catalogGame =
      this.catalog.getGame(id) ||
      this.catalog.searchIndex?.find((game) => game.options.some((option) => option.gameId === id));
    if (!installed && !catalogGame)
      throw Error('This game is unavailable. Refresh your library or search again.');
    const name = installed?.name || catalogGame.name;
    const steamId = installed?.steamId || catalogGame?.steamId;
    const identity = steamId
      ? await this.identity.details(steamId).catch(() => null)
      : await this.identity.identify(name);
    const info = identity?.steamId
      ? await this.identity.details(identity.steamId).catch(() => identity)
      : identity;
    const installations = installed
      ? installed.installations || [installed]
      : this.library.installations.filter(
          (game) =>
            game.name === name || (info?.steamId && game.identity?.steamId === info.steamId),
        );
    const base =
      installed ||
      this.library.items.find(
        (game) => (game.steamId && game.steamId === info?.steamId) || game.name === name,
      );
    const source = (info?.steamId ? this.steamSearch.forApp(info) : null) || catalogGame;
    await this.identity.save().catch(() => {});
    let space = null;
    try {
      space = await storageInfo(this.config.downloadPath, sizeBytes(source?.options[0]?.fileSize));
    } catch (error) {
      space = { error: error.message };
    }
    return {
      id: base?.id || source?.id || id,
      name: info?.name || name,
      cover: info?.cover || base?.cover || source?.cover,
      description: info?.description || '',
      genres: info?.genres || [],
      developers: info?.developers || [],
      releaseDate: info?.releaseDate || null,
      steamId: info?.steamId || base?.steamId || null,
      libraryId: base?.id || null,
      catalogId: source?.id || null,
      favorite: base?.favorite || false,
      lastPlayed: base?.lastPlayed || null,
      installations: base?.installations || installations,
      dlcs: base?.dlcs || [],
      demos: base?.demos || [],
      availableDlcCount: info?.dlcIds?.length || 0,
      space,
    };
  }
  async selectLauncher(id, file) {
    const game = this.library.get(id);
    if (!game) throw Error('Game not found. Refresh the library.');
    if (this.installationBusy(game))
      throw Error(
        'Wait for this download or installation to finish before changing its startup file.',
      );
    authorizeGame(this.config, this.libraryState.data.imports, game);
    require('./library.cjs').within(game.folder, file);
    require('./shortcuts.cjs').launchTarget(file);
    if (!(await fs.lstat(file)).isFile()) throw Error('The startup file is unavailable.');
    const manifestFile = path.join(game.folder, '.mamba-game.json');
    let manifest = {};
    try {
      manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    } catch {}
    await atomicJson(manifestFile, {
      ...manifest,
      name: game.name,
      executable: path.relative(game.folder, file),
      launcherSelected: true,
      status: 'installed',
    });
    const selected = { ...game, executable: file };
    await require('./game-helper.cjs').installGameHelper(game.folder);
    const steam = await registerSteam(selected).catch((error) => ({
      status: 'pending',
      message: error.message,
    }));
    await atomicJson(manifestFile, {
      ...JSON.parse(await fs.readFile(manifestFile, 'utf8')),
      steam,
    });
    await desktopShortcut(
      require('./library.cjs').safeName(game.name),
      file,
      path.dirname(file),
    ).catch((error) =>
      this.emit('service:issue', {
        context: 'library:launcher',
        message:
          'The launcher was saved, but the desktop shortcut could not be created: ' + error.message,
      }),
    );
    await this.addXboxGame(selected).catch((error) =>
      this.emit('service:issue', {
        context: 'library:launcher',
        message: 'The launcher was saved, but Xbox registration needs review: ' + error.message,
      }),
    );
    await this.library.scan();
    return { steam };
  }
  installationBusy(game) {
    return this.downloads.jobs.some(
      (job) =>
        this.downloads.controllers.has(job.id) &&
        job.folder &&
        path.resolve(job.folder).toLowerCase() === path.resolve(game.folder).toLowerCase(),
    );
  }
  async addXboxGame(game) {
    const group = this.catalog.searchIndex?.find((entry) => entry.name === game.name);
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
        const xbox = await this.addXboxGame(game).catch((error) => ({
          status: 'pending',
          message: error.message,
        }));
        await atomicJson(file, { ...manifest, xbox });
      } catch {}
    }
  }
  async maintenance() {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      if (this.library.items.some((game) => game.repairPending)) await this.library.scan();
      await this.syncXboxLibrary();
      for (const game of this.library.items) {
        if (this.stopping) break;
        try {
          const file = path.join(game.folder, '.mamba-game.json');
          const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
          if (manifest.steam?.status !== 'pending' || !game.executable) continue;
          const steam = await registerSteam(game).catch((error) => ({
            status: 'pending',
            message: error.message,
          }));
          await atomicJson(file, { ...manifest, steam });
        } catch {}
      }
    } finally {
      this.busy = false;
    }
  }
  async call(method, args = []) {
    if (
      this.cleanup?.removing &&
      ['downloads:best', 'downloads:start', 'downloads:retry'].includes(method)
    )
      throw Error('Wait for file cleanup to finish before starting downloads.');
    switch (method) {
      case 'initialize':
        return this.initialize(args);
      case 'configure':
        this.config = args[0];
        return true;
      case 'catalog:sync':
        this.catalog.sync(args[0]).catch(() => {});
        return this.catalog.state;
      case 'catalog:cancel':
        clearTimeout(this.catalog.retryTimer);
        this.catalog.controller?.abort();
        return this.catalog.status({
          phase: 'idle',
          message: 'Source sync stopped. Previously checked downloads are kept.',
        });
      case 'catalog:search':
        return this.steamSearch.search(...args);
      case 'catalog:resolve':
        return this.catalog.resolveGame(...args);
      case 'catalog:download-options': {
        const hosts =
          this.catalog.sourceHosts && Object.keys(this.catalog.sourceHosts).length
            ? { ...this.catalog.sourceHosts }
            : {};
        if (!Object.keys(hosts).length)
          for (const game of this.catalog.games)
            for (const link of game.links) {
              const host = require('./download-services.cjs').hostKey(link.uri);
              hosts[host] = (hosts[host] || 0) + 1;
            }
        return Object.entries(hosts)
          .map(([host, count]) => ({ host, count }))
          .sort((a, b) => b.count - a.count);
      }
      case 'catalog:artwork':
        return this.artwork.get(...args);
      case 'home:featured':
        return this.steamFeatured.get();
      case 'downloads:best':
        return this.downloads.startBest(...args);
      case 'downloads:start': {
        if (args[2]) {
          const game = this.catalog.getGame(args[2]);
          if (
            !game?.options.some(
              (option) => option.gameId === args[0] && option.linkIndex === args[1],
            )
          )
            throw Error(
              'This download is no longer associated with the selected Steam game. Search again.',
            );
          return this.downloads.start(args[0], args[1], game.name, args[3]);
        }
        return this.downloads.start(...args);
      }
      case 'downloads:cancel':
        return this.downloads.cancel(...args);
      case 'downloads:pause':
        return this.downloads.pause(...args);
      case 'downloads:retry':
        return this.downloads.retry(...args);
      case 'downloads:remove':
        return this.downloads.remove(...args);
      case 'downloads:clear-finished':
        return this.downloads.clearFinished();
      case 'library:scan':
        return this.library.scan();
      case 'library:get':
        return this.library.get(...args);
      case 'library:busy': {
        const game = this.library.get(args[0]);
        return game ? this.installationBusy(game) : false;
      }
      case 'game:details':
        return this.gameDetails(...args);
      case 'cleanup:scan':
        await this.library.scan();
        return this.cleanup.scan();
      case 'cleanup:preview':
        return this.cleanup.preview(...args);
      case 'cleanup:remove':
        return this.cleanup.remove(...args);
      case 'storage:check':
        return storageInfo(this.config.downloadPath, 0, { probe: true });
      case 'library:import':
        await this.libraryState.addImport(args[0]);
        return this.library.scan();
      case 'library:forget':
        await this.libraryState.forget(args[0]);
        return this.library.scan();
      case 'library:favorite': {
        const game = this.library.get(args[0]);
        if (!game) throw Error('Game not found.');
        await this.libraryState.favorite(game, args[1]);
        this.library.items = this.libraryState.decorate(this.library.items);
        this.emit('library:changed', this.library.items);
        return true;
      }
      case 'library:played': {
        const game = this.library.get(args[0]);
        if (!game) return;
        await this.libraryState.played(game);
        this.library.items = this.libraryState.decorate(this.library.items);
        this.emit('library:changed', this.library.items);
        return true;
      }
      case 'library:launcher':
        return this.selectLauncher(...args);
      case 'shutdown':
        this.stopping = true;
        clearInterval(this.timer);
        clearTimeout(this.catalog?.retryTimer);
        this.catalog?.controller?.abort();
        this.downloads?.stop();
        await this.downloads?.persist();
        return true;
      default:
        throw new Error('Unknown background task.');
    }
  }
}
module.exports = { BackgroundService };
