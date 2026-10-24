const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  GameIdentity,
  matchesTitle,
  cleanTitle,
  groupInstallations,
  isNonGame,
} = require('../src/core/game-identity.cjs');
const { LibraryState } = require('../src/core/experience.cjs');
const { installedMetadata, steamFolders } = require('../src/core/installed-metadata.cjs');

test('joined folder names resolve without merging numbered sequels or remasters', () => {
  for (const [folder, title] of [
    ['POSTAL2Complete', 'POSTAL 2'],
    ['GarrysMod', "Garry's Mod"],
    ['BloonsTD6', 'Bloons TD 6'],
    ['Worldbox', 'WorldBox - God Simulator'],
    ['Fallout', 'Fallout: A Post Nuclear Role Playing Game'],
  ])
    assert.ok(matchesTitle(folder, title), folder);
  assert.equal(cleanTitle('POSTAL2Complete'), 'POSTAL 2');
  assert.equal(matchesTitle('Fallout', 'Fallout 4'), false);
  assert.equal(matchesTitle('Fallout', 'Fallout: New Vegas'), false);
  assert.equal(matchesTitle('Game', 'Game: Another Adventure'), false);
  assert.equal(matchesTitle('Game', 'Game Remastered'), false);
});

test('Minecraft editions retain distinct names and library identities offline', async () => {
  const service = new GameIdentity('unused', () => {
    throw Error('offline');
  });
  const java = await service.identify('Minecraft Launcher');
  const bedrock = await service.identify('Minecraft for');
  assert.equal(java.name, 'Minecraft');
  assert.equal(bedrock.name, 'Minecraft For Windows (Bedrock Edition)');
  const result = await groupInstallations(
    [
      { id: 'java', name: 'Minecraft Launcher', folder: path.resolve('java') },
      { id: 'bedrock', name: 'Minecraft for', folder: path.resolve('bedrock') },
    ],
    (...args) => service.identify(...args),
  );
  assert.equal(result.items.length, 2);
  const state = new LibraryState('unused');
  assert.notEqual(state.key(result.items[0]), state.key(result.items[1]));
});

test('DLC suffixes require confirmed DLC type; software never becomes a game card', async () => {
  const apps = {
    1: { name: 'Trailmakers: Space Voyager Pack', type: 'dlc', fullgame: { appid: 3 } },
    2: { name: 'Trailmakers: Decals Action Pack', type: 'dlc', fullgame: { appid: 3 } },
    3: { name: 'Trailmakers', type: 'game' },
    4: { name: 'Paint Tool', type: 'application' },
    5: { name: "Garry's Mod", type: 'game' },
  };
  const service = new GameIdentity('unused', async (url) => ({
    ok: true,
    json: async () => {
      const u = new URL(url);
      if (u.pathname.includes('storesearch'))
        return {
          items: Object.entries(apps).map(([id, app]) => ({ id: Number(id), name: app.name })),
        };
      const id = u.searchParams.get('appids');
      return { [id]: { success: true, data: apps[id] } };
    },
  }));
  service.save = async () => {};
  for (const name of ['Space Voyager Pack', 'Decals- Action Pack']) {
    const identity = await service.identify(name);
    assert.equal(identity.type, 'dlc', name);
    assert.equal(identity.baseGame.name, 'Trailmakers');
  }
  assert.equal((await service.identify('GarrysMod')).verified, true);
  assert.equal(isNonGame(await service.identify('Paint Tool')), true);
  const result = await groupInstallations(
    [{ id: 'vr', name: 'SteamVR', folder: path.resolve('vr') }],
    (...args) => service.identify(...args),
  );
  assert.equal(result.items.length, 0);
});

test('identity upgrades replace old remembered entries and preserve favorites', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-identities-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = new LibraryState(root);
  await state.load();
  const old = {
    id: 'old',
    name: 'Worldbox',
    folder: path.join(root, 'Worldbox'),
    status: 'installed',
  };
  await state.change((data) => {
    data.remembered[state.key(old)] = old;
  });
  await state.favorite(old, true);
  const games = await state.reconcile([
    { ...old, name: 'WorldBox - God Simulator', steamId: 1206560, verified: true },
  ]);
  assert.equal(games.length, 1);
  assert.equal(games[0].favorite, true);
});

test('Xbox display names and artwork are read locally and Steam manifest titles override folder spelling', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-local-meta-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'Content'));
  await fs.writeFile(path.join(root, 'Content', 'cover.png'), 'image fixture');
  await fs.writeFile(
    path.join(root, 'Content', 'MicrosoftGame.config'),
    '<Game><DefaultDisplayName>GeoGuessr Duels</DefaultDisplayName><Square150x150Logo>cover.png</Square150x150Logo></Game>',
  );
  const meta = await installedMetadata(root);
  assert.equal(meta.name, 'GeoGuessr Duels');
  assert.match(meta.cover, /^data:image\/png;base64,/);
  const steamapps = path.join(root, 'steamapps');
  await fs.mkdir(path.join(steamapps, 'common'), { recursive: true });
  await fs.writeFile(
    path.join(steamapps, 'appmanifest_2230.acf'),
    '"AppState" { "name" "POSTAL 2" "installdir" "POSTAL2Complete" }',
  );
  assert.equal(
    (await steamFolders(path.join(steamapps, 'common'))).get('postal2complete'),
    'POSTAL 2',
  );
});
