const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../src/core/library.cjs');
const { LibraryState } = require('../src/core/experience.cjs');
const system = require('../src/core/system-games.cjs');
const { confirmedGame } = require('../src/shared/game-presence.js');
const { validateSettings, encodeConfig, decodeConfig } = require('../src/core/config-transfer.cjs');

test('Steam library paths preserve escaped Windows separators', () => {
  assert.deepEqual(
    system.steamLibraries('"libraryfolders" { "1" { "path" "Z:\\\\Custom\\\\Steam" } }'),
    ['Z:\\Custom\\Steam'],
  );
});
test('automatic discovery scans custom roots and direct installs once; disabling it leaves manual folders active', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-discover-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const extra = path.join(root, 'extra');
  const direct = path.join(root, 'custom', 'Game');
  for (const folder of [path.join(main, 'Main'), path.join(extra, 'Other'), direct]) {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'game.exe'), 'fixture');
  }
  t.mock.method(system, 'discoverSystemGames', async () => ({
    roots: [extra],
    games: [direct, path.join(extra, 'Other')],
  }));
  const config = { downloadPath: main };
  const library = new Library(async () => config);
  assert.equal((await library.scan()).length, 3);
  config.automaticGameDetection = false;
  assert.equal((await library.scan()).length, 1);
  config.extraGameFolders = [extra];
  assert.equal((await library.scan()).length, 2);
});
test('unverified candidates are optional and are not remembered as library games', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-unknown-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = new LibraryState(root);
  await state.load();
  const candidates = [
    { id: 'unknown', name: 'Unknown', verified: false },
    { id: 'known', name: 'Known', steamId: 10, verified: true },
  ];
  assert.deepEqual(
    candidates.filter(confirmedGame).map((item) => item.id),
    ['known'],
  );
  assert.equal((await state.reconcile(candidates)).length, 2);
  assert.equal(Object.keys(state.data.remembered).length, 1);
  assert.equal((await state.reconcile([])).length, 1);
});
test('library layouts, unknown visibility, and detection preferences round-trip and reject malformed values', () => {
  for (const libraryView of ['cards', 'list', 'banners']) {
    const settings = {
      libraryView,
      libraryShowUnknown: true,
      automaticGameDetection: false,
      libraryFavoritesOnly: true,
    };
    assert.deepEqual(decodeConfig(encodeConfig(settings)), settings);
  }
  assert.throws(() => validateSettings({ libraryView: 'bogus' }), /library view/);
  assert.throws(() => validateSettings({ libraryShowUnknown: 'yes' }), /true or false/);
});
