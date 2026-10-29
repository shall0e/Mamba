const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { LibraryState } = require('../src/core/experience.cjs');
const { Library } = require('../src/core/library.cjs');
const { encodeConfig, decodeConfig } = require('../src/core/config-transfer.cjs');
const { installed } = require('../src/shared/game-presence.js');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-remember-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = new LibraryState(dir);
  await state.load();
  return { dir, state };
}
const game = (folder) => ({
  id: 'portal',
  name: 'Portal',
  steamId: 400,
  verified: true,
  cover: 'cover',
  folder,
  executable: path.join(folder, 'game.exe'),
  status: 'installed',
  releaseId: 'release',
  installedAt: '2026-01-01',
});

test('missing installations persist across restart with favorites, artwork, and history; rediscovery restores Play', async (t) => {
  const { dir, state } = await fixture(t);
  const entry = game(path.join(dir, 'Portal'));
  await state.reconcile([entry]);
  await state.favorite(entry, true);
  await state.played(entry);
  const restored = new LibraryState(dir);
  await restored.load();
  const [missing] = await restored.reconcile([]);
  assert.equal(missing.status, 'not-installed');
  assert.equal(missing.executable, null);
  assert.equal(missing.favorite, true);
  assert.ok(missing.lastPlayed);
  assert.equal(missing.cover, 'cover');
  assert.equal(missing.releaseId, 'release');
  assert.equal(installed([missing], entry), null);
  const [found] = await restored.reconcile([entry]);
  assert.equal(found.status, 'installed');
  assert.equal(found.favorite, true);
  assert.equal(found.installations.length, 1);
});

test('one remaining installation stays playable; removed entries stay hidden until explicitly restored', async (t) => {
  const { dir, state } = await fixture(t);
  const first = game(path.join(dir, 'first'));
  const second = { ...game(path.join(dir, 'second')), id: 'second' };
  await fs.mkdir(first.folder);
  await fs.writeFile(first.executable, 'kept');
  await state.reconcile([{ ...first, installations: [first, second] }]);
  const [remaining] = await state.reconcile([{ ...second, installations: [second] }]);
  assert.equal(remaining.status, 'installed');
  assert.equal(remaining.installations.length, 2);
  assert.equal(remaining.installations[1].status, 'not-installed');
  await state.favorite(remaining, true);
  await assert.rejects(state.remove(remaining), /Uninstall all copies/);
  await fs.rm(first.folder, { recursive: true });
  const [uninstalled] = await state.reconcile([]);
  await state.remove(uninstalled);
  assert.deepEqual(await state.reconcile([first]), []);
  assert.equal(await fs.stat(first.folder).catch(() => null), null);
  assert.equal(state.data.games['steam:400'], undefined);
  await state.restore(first);
  assert.equal((await state.reconcile([first])).length, 1);
});

test('unavailable drives remain distinct from uninstalled games', async (t) => {
  const { state } = await fixture(t);
  const entry = game(path.resolve('drive-fixture', 'Game'));
  await state.reconcile([entry]);
  t.mock.method(fs, 'access', async () => {
    throw Object.assign(Error('offline'), { code: 'ENOENT' });
  });
  const [missing] = await state.reconcile([]);
  assert.equal(missing.status, 'drive-unavailable');
  assert.equal((await state.reconcile([entry]))[0].status, 'installed');
});

test('configuration transfer round-trips the complete library and accepts older exports', async (t) => {
  const { dir, state } = await fixture(t);
  const entry = game(path.join(dir, 'Portal'));
  await state.reconcile([entry]);
  await state.favorite(entry, true);
  await state.played(entry);
  const settings = {
    libraryState: state.data,
    libraryAvailability: 'not-installed',
    torboxApiKey: 'fixture',
  };
  assert.deepEqual(decodeConfig(encodeConfig(settings, '1.4.2')), settings);
  assert.deepEqual(decodeConfig(encodeConfig({ autoInstall: true }, '1.4.2')), {
    autoInstall: true,
  });
  assert.throws(
    () => decodeConfig(JSON.stringify({ libraryState: { games: {}, imports: [123] } })),
    /library export/,
  );
  const restored = new LibraryState(path.join(dir, 'restored'));
  await fs.mkdir(path.join(dir, 'restored'));
  await restored.change((data) =>
    Object.assign(data, decodeConfig(encodeConfig(settings)).libraryState),
  );
  assert.equal((await restored.reconcile([]))[0].favorite, true);
});

test('scanning a missing games folder leaves it absent and returns no live installations', async (t) => {
  const { dir } = await fixture(t);
  const root = path.join(dir, 'absent');
  const library = new Library(async () => ({ downloadPath: root, automaticGameDetection: false }));
  assert.deepEqual(await library.scan(), []);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('favorites lead normal sorts while recently installed orders by installation date', () => {
  const { compareLibrary } = require('../src/shared/game-presence.js');
  const games = [
    { name: 'Alpha', lastPlayed: '2026-10-23', installedAt: '2026-10-23' },
    {
      name: 'Zulu',
      favorite: true,
      status: 'not-installed',
      lastPlayed: '2025-01-01',
      installedAt: '2025-01-01',
    },
    { name: 'Bravo', favorite: true, lastPlayed: '2026-10-22', installedAt: '2026-10-22' },
  ];
  for (const sort of ['name', 'recent', 'installed']) {
    const sorted = [...games].sort((a, b) => compareLibrary(a, b, sort));
    assert.deepEqual(
      sorted.map((item) => item.name),
      sort !== 'name' ? ['Alpha', 'Bravo', 'Zulu'] : ['Bravo', 'Zulu', 'Alpha'],
    );
  }
});

test('external play history survives restart and older personal history cannot overwrite it', async (t) => {
  const { dir, state } = await fixture(t);
  const entry = { ...game(path.join(dir, 'Portal')), lastPlayed: '2026-10-28T12:00:00Z' };
  state.data.games[state.key(entry)] = { lastPlayed: '2026-01-01T00:00:00Z', favorite: true };
  assert.equal((await state.reconcile([entry]))[0].lastPlayed, entry.lastPlayed);
  const restored = new LibraryState(dir);
  await restored.load();
  assert.equal(restored.decorate([{ ...entry, lastPlayed: null }])[0].lastPlayed, entry.lastPlayed);
  await restored.reconcile([]);
  const reinstalled = (await restored.reconcile([entry]))[0];
  assert.ok(Date.parse(reinstalled.installedAt) > Date.parse(entry.installedAt));
});

test('per-installation folder choice reaches the queue without changing the global Games folder', async () => {
  const { BackgroundService } = require('../src/core/background-service.cjs');
  const service = new BackgroundService(() => {});
  service.libraryState = { restore: async () => {} };
  service.catalog = {
    getGame: () => ({ name: 'Fixture', options: [{ gameId: 'release', linkIndex: 0 }] }),
  };
  let received;
  service.downloads = {
    start: async (...args) => {
      received = args;
      return 'job';
    },
  };
  const folder = path.resolve('custom-install');
  await service.call('downloads:start', ['release', 0, 'steam:10', 'direct', folder]);
  assert.deepEqual(received, ['release', 0, 'Fixture', 'direct', folder]);
});
