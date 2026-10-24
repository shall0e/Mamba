const test = require('node:test'),
  assert = require('node:assert/strict');
const { installed, download } = require('../src/shared/game-presence.js');
test('recognizes exact installed identities without confusing sequels', () => {
  const games = [
    {
      id: 'folder1',
      name: 'Example® Game',
      steamId: 10,
      status: 'installed',
      executable: 'game.exe',
    },
  ];
  assert.equal(installed(games, { id: 'steam:10', name: 'Localized name' }), games[0]);
  assert.equal(installed(games, { name: 'Example Game' }), games[0]);
  assert.equal(installed(games, { name: 'Example Game 2' }), null);
  assert.equal(installed(games, { name: 'Example Game', steamId: 20 }), null);
});
test('existing downloads are recognized by release or exact game name', () => {
  const jobs = [{ id: 'job', name: 'Example Game', gameId: 'release', status: 'paused' }];
  assert.equal(download(jobs, { name: 'Example Game', options: [] }), jobs[0]);
  assert.equal(download(jobs, { name: 'Other label', options: [{ gameId: 'release' }] }), jobs[0]);
  assert.equal(download(jobs, { name: 'Example Game 2' }), null);
  assert.equal(download([{ ...jobs[0], status: 'cancelled' }], { name: 'Example Game' }), null);
});

test('installed games precede uninstalled games for every sort, with favorites within each group', () => {
  const { compareLibrary } = require('../src/shared/game-presence.js');
  const games = [
    { name: 'Installed favorite', status: 'installed', favorite: true },
    { name: 'Uninstalled', status: 'not-installed' },
    { name: 'Uninstalled favorite', status: 'not-installed', favorite: true },
    { name: 'Installed', status: 'installed' },
  ];
  for (const sort of ['name', 'recent', 'installed']) {
    const result = [...games].sort((a, b) => compareLibrary(a, b, sort));
    assert.deepEqual(
      result.map((game) => game.name),
      ['Installed favorite', 'Installed', 'Uninstalled favorite', 'Uninstalled'],
    );
  }
});
