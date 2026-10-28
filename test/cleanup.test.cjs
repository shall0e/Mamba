const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

test('CLI jobs works without config and does not create service state', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-cli-readonly-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.resolve('tools/mamba-cli.cjs'), 'jobs'],
    { env: { ...process.env, MAMBA_DATA_DIR: directory } },
  );
  assert.equal(stdout, '');
  assert.deepEqual(await fs.readdir(directory), []);
});

test('MegaSource shares catalog validation, skips empty releases, and deduplicates links', async (t) => {
  const uri = 'https://example.com/game.zip';
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          name: 'Fixture',
          downloads: [
            { title: 'Game', uris: [uri, uri, 'file:///private'] },
            { title: 'Empty', uris: ['javascript:bad'] },
          ],
        }),
      ),
  );
  const { combine } = require('../tools/build-megasource.cjs');
  const combined = await combine([
    'https://example.com/source.json',
    'https://example.com/source.json',
  ]);
  assert.equal(combined.downloads.length, 1);
  assert.deepEqual(combined.downloads[0].uris, [uri]);
  await assert.rejects(combine(['https://example.com/source?token=secret']), /public HTTPS/);
});

test('failed preference saves do not change the in-memory library', async (t) => {
  const { LibraryState } = require('../src/core/experience.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-preference-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = new LibraryState(root);
  t.mock.method(fs, 'rename', async () => {
    throw Error('disk write failed');
  });
  await assert.rejects(state.favorite({ name: 'Game' }, true), /disk write failed/);
  assert.deepEqual(state.data.games, {});
});

test('equivalent Steam queries share one request and invalid offsets become zero', async () => {
  const { SteamSearch } = require('../src/core/steam-search.cjs');
  let requests = 0;
  const search = new SteamSearch('unused', { games: [] }, {}, async () => {
    requests++;
    return new Response(JSON.stringify({ items: [] }));
  });
  search.save = async () => {};
  await Promise.all([search.steamResults(' Game   Name '), search.steamResults('game name')]);
  assert.equal(requests, 1);
  const offsets = [];
  search.localResults = (_query, offset) => {
    offsets.push(offset);
    return { items: [], total: 0 };
  };
  search.enrich = async () => {};
  for (const offset of [-1, NaN, Infinity, '20', 0]) await search.search('Game Name', offset);
  await Promise.all([...search.searches.values()].map((state) => state.work));
  assert.ok(offsets.filter((value) => value !== undefined).every((value) => value === 0));
});

test('artwork loads at most four covers concurrently and shares duplicate requests', async () => {
  const { Artwork } = require('../src/core/artwork.cjs');
  const artwork = new Artwork('unused', {});
  let active = 0,
    peak = 0,
    calls = 0;
  const releases = [];
  artwork.load = async (id) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active--;
    return id;
  };
  const jobs = Array.from({ length: 10 }, (_, i) => artwork.get(String(i)));
  assert.equal(artwork.get('0'), jobs[0]);
  assert.equal(active, 4);
  while (releases.length || artwork.waiting.length) {
    releases.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(
    await Promise.all(jobs),
    Array.from({ length: 10 }, (_, i) => String(i)),
  );
  assert.equal(peak, 4);
  assert.equal(calls, 10);
});

test('failed artwork requests are cached across instances to prevent retry storms', async (t) => {
  const { Artwork } = require('../src/core/artwork.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-art-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const catalog = { getGame: () => ({ id: 'game', name: 'Game', verified: true }) };
  const transport = async () => {
    calls++;
    throw Error('offline');
  };
  assert.equal(await new Artwork(root, catalog, transport).get('game'), null);
  assert.equal(await new Artwork(root, catalog, transport).get('game'), null);
  assert.equal(calls, 1);
});

test('unchanged configuration updates skip disk writes and background notifications', async (t) => {
  const { createConfigStore } = require('../src/main/config-store.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-config-noop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'config.json');
  await fs.writeFile(
    file,
    JSON.stringify({ sourceUrls: [], extraGameFolders: [], downloadPath: root }),
  );
  let changes = 0;
  const store = createConfigStore({
    app: { getPath: () => root },
    dataDirectory: () => root,
    onChange: async () => {
      changes++;
    },
    getInstalledGames: () => [],
    reportIssue: () => {},
  });
  const original = await fs.readFile(file, 'utf8');
  await store.updateConfig(() => {});
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.equal(changes, 0);
  await store.updateConfig((config) => {
    config.notifications = false;
  });
  assert.equal(changes, 1);
});

test('incremental source merging deduplicates links across batches without leaking index metadata', () => {
  const { mergeDownloads } = require('../src/core/catalog.cjs');
  const accumulator = { games: new Map(), records: 0 };
  const source = {
    name: 'Fixture',
    downloads: [{ title: 'Game', uris: ['https://example.com/one', 'https://example.com/one'] }],
  };
  mergeDownloads([source], accumulator);
  mergeDownloads(
    [
      {
        ...source,
        downloads: [
          { title: 'game', uris: ['https://example.com/one', 'https://example.com/two'] },
        ],
      },
    ],
    accumulator,
  );
  assert.equal(accumulator.games.size, 1);
  const game = [...accumulator.games.values()][0];
  assert.equal(game.links.length, 2);
  assert.equal(JSON.stringify(game).includes('seenLinks'), false);
});
