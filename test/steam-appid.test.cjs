const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { writeSteamAppId } = require('../src/core/steam-appid.cjs');

test('writes the Steam ID at the root and beside the launcher, replacing stale values', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-appid-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.mkdir(path.join(folder, 'bin'));
  await fs.writeFile(path.join(folder, 'steam_appid.txt'), 'wrong');
  assert.equal(await writeSteamAppId(folder, 'bin/game.exe', 620), true);
  for (const target of ['steam_appid.txt', 'bin/steam_appid.txt'])
    assert.equal(await fs.readFile(path.join(folder, target), 'utf8'), '620\n');
  for (const id of [null, undefined, 0, -1, 'unknown', 1.5])
    assert.equal(await writeSteamAppId(folder, null, id), false);
  assert.equal(await fs.readFile(path.join(folder, 'steam_appid.txt'), 'utf8'), '620\n');
});

test('installation hook resolves the game identity and writes after metadata extraction', async (t) => {
  const { BackgroundService } = require('../src/core/background-service.cjs');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-appid-hook-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const service = {
    installMetadata: {
      apply: async () => fs.writeFile(path.join(folder, 'steam_appid.txt'), 'stale archive ID'),
    },
    identity: {
      identify: async (name) => {
        assert.equal(name, 'Portal 2');
        return { verified: true, steamId: 620 };
      },
    },
    emit: () => assert.fail('unexpected installation issue'),
  };
  await BackgroundService.prototype.applyInstallMetadata.call(service, folder, {
    name: 'Portal 2',
  });
  assert.equal(await fs.readFile(path.join(folder, 'steam_appid.txt'), 'utf8'), '620\n');
  service.identity.identify = async () => ({ verified: false, steamId: 999 });
  service.installMetadata.apply = async () => {};
  await BackgroundService.prototype.applyInstallMetadata.call(service, folder, { name: 'Unknown' });
  assert.equal(await fs.readFile(path.join(folder, 'steam_appid.txt'), 'utf8'), '620\n');
});
