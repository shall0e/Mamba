const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { SteamLibrary, parseTextVdf } = require('../src/core/steam-library.cjs');
test('Steam text config handles nested objects and escaped paths', () => {
  assert.equal(
    parseTextVdf('"a" { "path" "D:\\\\Games" "nested" {"v" "yes"} }').a.path,
    'D:\\Games',
  );
  assert.equal(parseTextVdf('"a" {"nested" {"v" "yes"}}').a.nested.v, 'yes');
});
test('local Steam account imports only confirmed games and merges existing installations without duplicates', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-steam-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, 'userdata', '123', 'config');
  await fs.mkdir(config, { recursive: true });
  await fs.mkdir(path.join(root, 'config'));
  await fs.writeFile(
    path.join(root, 'config', 'loginusers.vdf'),
    '"users" {"76561197960265851" {"PersonaName" "Player"}}',
  );
  await fs.writeFile(
    path.join(config, 'localconfig.vdf'),
    '"UserLocalConfigStore" {"Software" {"Valve" {"Steam" {"apps" {"10" {"LastPlayed" "100"} "20" {} "30" {} "40" {}}}}}}',
  );
  const service = new SteamLibrary(
    {
      details: async (id) => ({
        steamId: id,
        name: id === 20 ? 'SteamVR' : 'Game ' + id,
        type: id === 30 ? 'dlc' : 'game',
        cover: 'cover',
      }),
      save: async () => {},
    },
    { profile: async () => path.join(config, 'shortcuts.vdf') },
  );
  const games = await service.read();
  assert.equal(service.state.accountName, 'Player');
  assert.deepEqual(
    games.map((g) => g.steamId).sort((a, b) => a - b),
    [10, 40],
  );
  const result = service.merge([
    {
      id: 'installed',
      steamId: 10,
      status: 'installed',
      folder: 'D:/Games/Game',
      executable: 'game.exe',
    },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'installed');
  assert.equal(result[0].steamLibrary, true);
  assert.equal(result[1].status, 'not-installed');
  assert.deepEqual(result[1].installations, []);
});
test('missing Steam session leaves the existing library untouched', async () => {
  const service = new SteamLibrary(
    {},
    {
      profile: async () => {
        throw Error('no Steam');
      },
    },
  );
  assert.deepEqual(await service.read(), []);
  assert.equal(service.state.connected, false);
  assert.deepEqual(service.merge([{ id: 'existing' }]), [{ id: 'existing' }]);
});

test('Steam reads share work, refresh history, and invalidate the cache on account switches', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-steam-switch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configs = [
    path.join(root, 'userdata', '1', 'config'),
    path.join(root, 'userdata', '2', 'config'),
  ];
  for (let i = 0; i < configs.length; i++) {
    await fs.mkdir(configs[i], { recursive: true });
    await fs.writeFile(
      path.join(configs[i], 'localconfig.vdf'),
      `"UserLocalConfigStore" {"Software" {"Valve" {"Steam" {"apps" {"${i + 10}" {"LastPlayed" "100"}}}}}}`,
    );
  }
  let account = 0,
    calls = 0;
  const service = new SteamLibrary(
    {
      details: async (id) => {
        calls++;
        return { steamId: id, name: 'Game ' + id, type: 'game' };
      },
      save: async () => {},
    },
    { profile: async () => path.join(configs[account], 'shortcuts.vdf') },
  );
  const [first, duplicate] = await Promise.all([service.read(), service.read()]);
  assert.equal(calls, 1);
  assert.equal(first, duplicate);
  await fs.writeFile(
    path.join(configs[0], 'localconfig.vdf'),
    '"UserLocalConfigStore" {"Software" {"Valve" {"Steam" {"apps" {"10" {"LastPlayed" "200"}}}}}}',
  );
  assert.equal((await service.read())[0].lastPlayed, new Date(200000).toISOString());
  assert.equal(calls, 1);
  account = 1;
  assert.deepEqual(
    (await service.read()).map((game) => game.steamId),
    [11],
  );
});
