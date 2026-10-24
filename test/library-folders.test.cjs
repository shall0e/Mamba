const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../src/core/library.cjs');
const { normalizeFolders, scanRoots } = require('../src/core/library-folders.cjs');
const { LibraryState } = require('../src/core/experience.cjs');

test('main and extra Steam libraries scan together, deduplicate, and leave external files untouched', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-folders-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const steam = path.join(root, 'SteamLibrary');
  const common = path.join(steam, 'steamapps', 'common');
  for (const [base, name] of [
    [main, 'Main Game'],
    [common, 'External Game'],
  ]) {
    const folder = path.join(base, name);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'game.exe'), 'fixture');
    await fs.writeFile(path.join(folder, '.mamba-game.json'), JSON.stringify({ name }));
  }
  const config = {
    automaticGameDetection: false,
    downloadPath: main,
    extraGameFolders: [steam, common, main, path.join(root, 'offline')],
  };
  const library = new Library(async () => config);
  const games = await library.scan();
  assert.equal(games.length, 2);
  assert.equal(games.find((item) => item.name === 'Main Game').imported, false);
  assert.equal(games.find((item) => item.name === 'External Game').imported, true);
  assert.deepEqual((await fs.readdir(path.join(common, 'External Game'))).sort(), [
    '.mamba-game.json',
    'game.exe',
  ]);
  assert.equal(config.downloadPath, main);
  assert.equal((await scanRoots(config)).filter((folder) => folder === common).length, 1);
  assert.equal(await fs.stat(path.join(root, 'offline')).catch(() => null), null);
});

test('folder validation rejects drives and relative paths and deduplicates folder names', () => {
  assert.throws(() => normalizeFolders(['relative']), /absolute/);
  assert.throws(() => normalizeFolders([path.parse(process.cwd()).root]), /entire drive/);
  assert.equal(normalizeFolders([process.cwd(), process.cwd().toUpperCase()]).length, 1);
});

test('library removal rejects installed, setup, offline, and remaining folders', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-removal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = new LibraryState(root);
  await state.load();
  const game = {
    id: 'one',
    name: 'Game',
    folder: path.join(root, 'Game'),
    status: 'not-installed',
  };
  for (const status of ['installed', 'needs-setup', 'drive-unavailable'])
    await assert.rejects(
      state.remove({ ...game, installations: [game, { ...game, status }] }),
      /Uninstall all copies/,
    );
  await fs.mkdir(game.folder);
  await assert.rejects(state.remove(game), /Uninstall all copies/);
  await fs.rmdir(game.folder);
  await state.remove(game);
  assert.equal(state.data.hidden['name:game'], true);
});
