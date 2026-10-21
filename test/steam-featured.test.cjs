const test = require('node:test');
const assert = require('node:assert/strict');
const { SteamFeatured } = require('../src/core/steam-featured.cjs');
test('home artwork excludes free to play games using metadata', async () => {
  const featured = new SteamFeatured(
    {
      details: async (id) => ({
        name: 'Example ' + id,
        type: 'game',
        mature: false,
        isFree: id === 1,
        steamArtwork: 'https://shared.fastly.steamstatic.com/example.jpg',
      }),
    },
    async () => Response.json({ top_sellers: { items: [{ id: 1 }, { id: 2 }] } }),
  );
  await featured.refresh();
  assert.deepEqual(
    featured.items.map((game) => game.id),
    [2],
  );
});
