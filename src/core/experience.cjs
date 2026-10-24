const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { atomicJson, within, detect } = require('./library.cjs');

const folderId = (folder) =>
  createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 24);
class LibraryState {
  constructor(directory) {
    this.file = path.join(directory, 'library-state.json');
    this.data = { games: {}, imports: [], remembered: {}, hidden: {} };
    this.queue = Promise.resolve();
  }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (
        !data ||
        typeof data.games !== 'object' ||
        Array.isArray(data.games) ||
        !Array.isArray(data.imports)
      )
        throw Error('Invalid library preferences.');
      require('./config-transfer.cjs').validateSettings({ libraryState: data });
      this.data = {
        games: data.games || {},
        imports: data.imports.filter(
          (folder) => typeof folder === 'string' && path.isAbsolute(folder),
        ),
        remembered: data.remembered || {},
        hidden: data.hidden || {},
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await fs.copyFile(this.file, this.file + '.backup-' + Date.now());
        await atomicJson(this.file, this.data);
        this.recovered = true;
      }
    }
  }
  async change(update) {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        update(this.data);
        await atomicJson(this.file, this.data);
      });
    this.queue = task;
    await task;
  }
  key(game) {
    if (game.platformId) return 'platform:' + game.platformId;
    const id = game.steamId || game.identity?.baseGame?.steamId || game.identity?.steamId;
    return id ? 'steam:' + id : 'name:' + game.name.toLocaleLowerCase();
  }
  decorate(items) {
    return items.map((game) => ({ ...game, ...this.data.games[this.key(game)] }));
  }
  async reconcile(items, excluded = []) {
    const nonGame = require('./game-identity.cjs').isNonGame;
    const excludedFolders = new Set(excluded.map((item) => item.folder));
    const visible = items.filter(
      (game) => !nonGame(game.identity || game) && !this.data.hidden[this.key(game)],
    );
    // Migrate folder-based entries when metadata resolves a canonical identity or DLC parent.
    await this.change((data) => {
      for (const game of visible) {
        const key = this.key(game);
        const folders = new Set(
          [...(game.installations || [game]), ...(game.dlcs || []), ...(game.demos || [])]
            .map((item) => item.folder)
            .filter(Boolean),
        );
        for (const [oldKey, old] of Object.entries(data.remembered)) {
          if (
            oldKey === key ||
            !(old.installations || [old]).some((item) => folders.has(item.folder))
          )
            continue;
          data.games[key] = { ...data.games[oldKey], ...data.games[key] };
          delete data.games[oldKey];
          delete data.remembered[oldKey];
        }
      }
    });
    const current = new Map(visible.map((game) => [this.key(game), game]));
    const missing = async (game) => {
      const drive = game.folder ? path.parse(game.folder).root : null;
      const available =
        !drive ||
        (await fs.access(drive).then(
          () => true,
          () => false,
        ));
      return {
        ...game,
        folderExists: false,
        status: available ? 'not-installed' : 'drive-unavailable',
        executable: null,
        installer: null,
        executables: [],
        repairPending: false,
      };
    };
    const result = [];
    for (const [key, saved] of Object.entries(this.data.remembered)) {
      if (
        this.data.hidden[key] ||
        nonGame(saved.identity || saved) ||
        (saved.installations || [saved]).some((item) => excludedFolders.has(item.folder))
      )
        continue;
      const live = current.get(key);
      const liveInstalls = live ? live.installations || [live] : [];
      const previous = saved.installations || [saved];
      const absent = await Promise.all(
        previous
          .filter((old) => old.folder && !liveInstalls.some((item) => item.folder === old.folder))
          .map(missing),
      );
      const installations = [...liveInstalls, ...absent];
      result.push(
        live
          ? { ...live, installations }
          : {
              ...(await missing(saved)),
              installations,
              status: absent.some((item) => item.status === 'drive-unavailable')
                ? 'drive-unavailable'
                : 'not-installed',
            },
      );
      current.delete(key);
    }
    result.push(...current.values());
    await this.change((data) => {
      for (const game of result)
        if (!data.hidden[this.key(game)] && game.verified && game.steamId)
          data.remembered[this.key(game)] = game;
    });
    return this.decorate(result.filter((game) => !this.data.hidden[this.key(game)]));
  }
  async remove(game) {
    for (const installation of game.installations || [game]) {
      if (installation.status !== 'not-installed' || installation.folderExists)
        throw Error('Uninstall all copies of this game before removing it from your library.');
      if (installation.folder) {
        const exists = await fs.stat(installation.folder).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (exists)
          throw Error('Uninstall all copies of this game before removing it from your library.');
      }
    }
    await this.change((data) => {
      const key = this.key(game);
      data.hidden[key] = true;
      delete data.remembered[key];
      delete data.games[key];
      const folders = new Set((game.installations || [game]).map((item) => item.folder));
      data.imports = data.imports.filter((folder) => !folders.has(folder));
    });
  }
  async restore(game) {
    await this.change((data) => {
      delete data.hidden[this.key(game)];
    });
  }
  async favorite(game, value) {
    await this.change((data) => {
      const key = this.key(game);
      data.games[key] = { ...data.games[key], favorite: !!value };
    });
  }
  async played(game) {
    await this.change((data) => {
      const key = this.key(game);
      data.games[key] = { ...data.games[key], lastPlayed: new Date().toISOString() };
    });
  }
  async addImport(folder) {
    const root = path.resolve(folder);
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || root === path.parse(root).root)
      throw Error('Choose the game installation folder, not an entire drive.');
    const found = await detect(root);
    if (!found.executable && !found.installer)
      throw Error('No game launcher was found. Choose the folder containing the game.');
    await this.change((data) => {
      if (!data.imports.some((item) => path.resolve(item).toLowerCase() === root.toLowerCase()))
        data.imports.push(root);
    });
    return root;
  }
  async forget(folder) {
    await this.change((data) => {
      data.imports = data.imports.filter(
        (item) => path.resolve(item).toLowerCase() !== path.resolve(folder).toLowerCase(),
      );
    });
  }
}

function sizeBytes(value) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/([\d.]+)\s*(bytes?|[kmgt]i?b)\b/i);
  if (!match) return 0;
  const unit = match[2].toLowerCase();
  const power = {
    b: 0,
    byte: 0,
    bytes: 0,
    kb: 1,
    kib: 1,
    mb: 2,
    mib: 2,
    gb: 3,
    gib: 3,
    tb: 4,
    tib: 4,
  }[unit];
  return Math.ceil(Number(match[1]) * (unit.includes('i') ? 1024 : 1000) ** power) || 0;
}
async function storageInfo(
  folder,
  bytes = 0,
  { probe = false, existing = 0, multiplier = 3, reserve = 1024 ** 3 } = {},
) {
  const root = path.resolve(folder);
  try {
    await fs.access(path.parse(root).root);
    await fs.mkdir(root, { recursive: true });
    if (probe) {
      const file = path.join(root, '.mamba-write-' + randomUUID());
      const handle = await fs.open(file, 'wx');
      await handle.close();
      await fs.unlink(file);
    }
    const stats = await fs.statfs(root).catch(() => null);
    const free = stats ? Number(stats.bavail) * Number(stats.bsize) : null;
    const required = bytes > 0 ? Math.max(0, bytes * multiplier - existing) + reserve : 0;
    return {
      free,
      required,
      downloadBytes: bytes,
      estimate: true,
      hasSpace: free === null || !required ? null : free >= required,
    };
  } catch (error) {
    const failure = new Error(
      error.code === 'ENOSPC'
        ? 'Not enough disk space in the Games folder. Free space or choose another folder.'
        : error.code === 'ENOENT'
          ? 'The games drive is unavailable. Choose an available Games folder in Settings.'
          : 'Mamba cannot write to the Games folder. Choose a writable folder in Settings.',
    );
    failure.code = error.code || 'EACCES';
    throw failure;
  }
}
async function ensureSpace(folder, bytes, options) {
  const info = await storageInfo(folder, bytes, options);
  if (info.hasSpace === false) {
    const error = new Error(
      'Not enough disk space for the download, extraction and setup. Free space or choose another Games folder in Settings.',
    );
    error.code = 'ENOSPC';
    error.storage = info;
    throw error;
  }
  return info;
}
function authorizeGame(config, imports, game) {
  if (
    imports.some(
      (folder) => path.resolve(folder).toLowerCase() === path.resolve(game.folder).toLowerCase(),
    )
  )
    return;
  within(config.downloadPath, game.folder);
  if (path.resolve(config.downloadPath) === path.resolve(game.folder))
    throw Error('The games root cannot be used as an installation.');
}
module.exports = { LibraryState, folderId, sizeBytes, storageInfo, ensureSpace, authorizeGame };
