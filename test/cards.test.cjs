const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Artwork, exactGameName } = require('../src/core/artwork.cjs');
const { Downloads } = require('../src/core/downloads.cjs');
test('artwork matches the exact game and reuses its local cache', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-art-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const artwork = new Artwork(
    dir,
    { searchIndex: [{ id: 'portal', name: 'Portal' }] },
    async (url) => {
      calls++;
      if (String(url).includes('storesearch'))
        return Response.json({
          items: [
            { id: 620, name: 'Portal 2' },
            { id: 400, name: 'Portal' },
          ],
        });
      assert.match(String(url), /\/400\/library_hero.jpg$/);
      return new Response(Buffer.from('fixture'), { headers: { 'content-type': 'image/png' } });
    },
  );
  assert.equal(await artwork.get('portal'), 'data:image/png;base64,Zml4dHVyZQ==');
  await artwork.get('portal');
  assert.equal(calls, 2);
  assert.equal(await artwork.get('missing'), null);
  assert.equal(exactGameName('Portal', 'Portal 2'), false);
});
test('artwork falls back to the supplied cover when the Steam hero is invalid', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-art-fallback-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const artwork = new Artwork(
    dir,
    { getGame: () => ({ name: 'Portal', steamId: 400, cover: 'https://example.test/cover.jpg' }) },
    async (url) => {
      calls.push(String(url));
      if (calls.length === 1)
        return new Response('missing', { headers: { 'content-type': 'text/html' } });
      return new Response(Buffer.from('fallback'), { headers: { 'content-type': 'image/jpeg' } });
    },
  );
  assert.equal(await artwork.get('portal'), 'data:image/jpeg;base64,ZmFsbGJhY2s=');
  assert.match(calls[0], /\/400\/library_hero.jpg$/);
  assert.equal(calls[1], 'https://example.test/cover.jpg');
});
test('Steam hero takes precedence over an embedded saved cover and caches it', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-art-embedded-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const catalog = {
    getGame: () => ({ name: 'Portal', steamId: 400, cover: 'data:image/png;base64,b2xk' }),
  };
  const artwork = new Artwork(dir, catalog, async (url) => {
    calls++;
    assert.match(String(url), /\/400\/library_hero.jpg$/);
    return new Response(Buffer.from('hero'), { headers: { 'content-type': 'image/jpeg' } });
  });
  assert.equal(await artwork.get('portal'), 'data:image/jpeg;base64,aGVybw==');
  assert.equal(await artwork.get('portal'), 'data:image/jpeg;base64,aGVybw==');
  assert.equal(calls, 1);
});
test('embedded saved cover remains available when the Steam hero fails', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-art-embedded-fallback-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cover = 'data:image/png;base64,b2xk';
  const artwork = new Artwork(
    dir,
    { getGame: () => ({ name: 'Portal', steamId: 400, cover }) },
    async () => {
      throw Error('offline');
    },
  );
  assert.equal(await artwork.get('portal'), cover);
});
test('one-click download resolves once and uses the selected release and link', async () => {
  let resolutions = 0;
  let selected;
  const downloads = new Downloads(
    '.',
    () => ({ torboxApiKey: 'key', preferredDownloadService: 'torbox', cachedOnly: true }),
    {
      byId: new Map([
        [
          'release',
          {
            links: [
              null,
              null,
              { uri: 'https://cdn.test/game.zip', services: ['torbox'], cached: false },
            ],
          },
        ],
      ]),
      resolveGame: async () => {
        resolutions++;
        return { name: 'Portal', best: { gameId: 'release', linkIndex: 2, services: ['direct'] } };
      },
    },
    {},
  );
  downloads.start = async (...args) => {
    selected = args;
    return 'job';
  };
  assert.deepEqual(await Promise.all([downloads.startBest('game'), downloads.startBest('game')]), [
    'job',
    'job',
  ]);
  assert.equal(resolutions, 1);
  assert.deepEqual(selected, ['release', 2, 'Portal', 'direct']);
});
test('unavailable game does not start a download', async () => {
  const downloads = new Downloads(
    '.',
    () => ({}),
    { resolveGame: async () => ({ message: 'No compatible download' }) },
    {},
  );
  downloads.start = () => assert.fail('must not download');
  await assert.rejects(downloads.startBest('game'), /No compatible download/);
});
