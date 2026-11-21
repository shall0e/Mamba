const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanTitle,
  matchesTitle,
  groupInstallations,
  GameIdentity,
} = require('../src/core/game-identity.cjs');
test('typographic dashes and apostrophes match their plain equivalents', () => {
  assert.equal(cleanTitle('Hollow Knight —'), 'Hollow Knight');
  assert.ok(matchesTitle('Assassins Creed', 'Assassin’s Creed'));
  assert.ok(matchesTitle('Farming Simulator', 'Farming – Simulator'));
  assert.ok(matchesTitle('PowerWash', 'PowerWash — Farm Simulator'));
});
test('clean release titles while preserving sequels and remasters', () => {
  assert.equal(cleanTitle('Fractal.Block.World.Build.18216058'), 'Fractal Block World');
  assert.equal(cleanTitle('Universe Sandbox (Early Access)'), 'Universe Sandbox');
  assert.ok(matchesTitle('COD Black Ops 3', 'Call of Duty: Black Ops III'));
  assert.ok(!matchesTitle('Call of Duty 4 Modern Warfare', 'Call of Duty Modern Warfare'));
  assert.ok(!matchesTitle('Modern Warfare', 'Modern Warfare Remastered'));
});
test('group installations by verified identity and associate installed DLC', async () => {
  const items = [
    {
      id: 'old',
      name: 'Game Build 1',
      folder: 'C:/old',
      status: 'installed',
      executable: 'C:/old/game.exe',
    },
    {
      id: 'new',
      name: 'Game Build 2',
      folder: 'C:/new',
      status: 'installed',
      executable: 'C:/new/game.exe',
    },
    { id: 'dlc', name: 'Expansion', folder: 'C:/dlc' },
  ];
  const base = {
    steamId: 10,
    name: 'Game',
    type: 'game',
    verified: true,
    cover: 'https://example.com/header.jpg',
  };
  const result = await groupInstallations(items, async (name) =>
    name === 'Expansion'
      ? { steamId: 11, name: 'Expansion', type: 'dlc', verified: true, baseGame: base }
      : base,
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'new');
  assert.equal(result.items[0].installations.length, 2);
  assert.equal(result.items[0].dlcs.length, 1);
  assert.equal(result.items[0].cover, base.cover);
  assert.equal(result.installations.length, 3);
});
test('DLC without installed base cannot be launched as base game', async () => {
  const result = await groupInstallations(
    [
      {
        id: 'dlc',
        name: 'DLC',
        folder: 'C:/dlc',
        executable: 'C:/dlc/tool.exe',
        status: 'installed',
      },
    ],
    async () => ({
      name: 'DLC',
      type: 'dlc',
      steamId: 11,
      verified: true,
      baseGame: { steamId: 10, name: 'Game', type: 'game' },
    }),
  );
  assert.equal(result.items[0].status, 'base-missing');
  assert.equal(result.items[0].executable, null);
});
test('non-game Steam products are rejected', async () => {
  const service = new GameIdentity('unused', async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes('storesearch')
        ? { items: [{ id: 10, name: 'Tool' }] }
        : { 10: { success: true, data: { name: 'Tool', type: 'music' } } },
  }));
  assert.equal((await service.identify('Tool')).verified, false);
});

test('Steam details retain screenshots and playable trailers and refresh older cached details', async () => {
  const identity = new GameIdentity('.', async () => ({
    ok: true,
    json: async () => ({
      123: {
        success: true,
        data: {
          name: 'Fixture',
          screenshots: [
            {
              path_thumbnail: 'https://shared.fastly.steamstatic.com/thumb.jpg',
              path_full: 'https://shared.fastly.steamstatic.com/full.jpg',
            },
          ],
          movies: [
            { name: 'Launch trailer', mp4: { 480: 'https://video.steamstatic.com/trailer.mp4' } },
            { name: 'No video' },
          ],
        },
      },
    }),
  }));
  identity.cache.set('app:123', { at: Date.now(), data: { detailsVersion: 6, name: 'Old' } });
  const details = await identity.fetchDetails(123);
  assert.equal(details.screenshots.length, 1);
  assert.equal(details.trailers.length, 1);
  assert.equal(details.trailers[0].name, 'Launch trailer');
  assert.equal(details.trailers[0].url, 'https://video.steamstatic.com/trailer.mp4');
  assert.equal(await identity.fetchDetails(123), details);
});

test('cached app details survive an offline refresh and recover exact installed identities', async () => {
  const identity = new GameIdentity('.', async () => {
    throw Error('offline');
  });
  const app = {
    name: 'People Playground',
    steamId: 1118200,
    type: 'game',
    detailsVersion: 6,
    description: 'Saved overview',
  };
  identity.cache.set('app:1118200', { at: 0, data: app });
  assert.equal(await identity.details(1118200), app);
  assert.equal((await identity.identify('People Playground')).steamId, 1118200);
  assert.equal((await identity.identify('People Playground Remastered')).verified, false);
});
