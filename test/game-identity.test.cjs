const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanTitle,
  matchesTitle,
  groupInstallations,
  GameIdentity,
} = require('../src/core/game-identity.cjs');
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
