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
      assert.match(String(url), /\/400\/header.jpg$/);
      return new Response(Buffer.from('fixture'), { headers: { 'content-type': 'image/png' } });
    },
  );
  assert.equal(await artwork.get('portal'), 'data:image/png;base64,Zml4dHVyZQ==');
  await artwork.get('portal');
  assert.equal(calls, 2);
  assert.equal(await artwork.get('missing'), null);
  assert.equal(exactGameName('Portal', 'Portal 2'), false);
});
test('one-click download resolves once and uses the selected release and link', async () => {
  let resolutions = 0;
  let selected;
  const downloads = new Downloads(
    '.',
    () => ({}),
    {
      resolveGame: async () => {
        resolutions++;
        return { name: 'Portal', best: { gameId: 'release', linkIndex: 2 } };
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
  assert.deepEqual(selected, ['release', 2, 'Portal']);
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
