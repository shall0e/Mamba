const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { Catalog, mergeDownloads } = require('../src/core/catalog.cjs');
const { TorBox, torrentHash } = require('../src/core/torbox.cjs');
const { Library, extractArchive, flatten, within } = require('../src/core/library.cjs');
const { Downloads, downloadFile } = require('../src/core/downloads.cjs');

const hash = '0123456789abcdef0123456789abcdef01234567';
const magnet = `magnet:?xt=urn:btih:${hash}`;
function zip(name, content) {
  const data = Buffer.from(content);
  const filename = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'mamba-pipeline-'));

test('merge deduplicates titles and torrent hashes without erasing different releases', () => {
  const merged = mergeDownloads([
    {
      name: 'One',
      downloads: [{ title: 'Example™ Game', uris: [magnet, magnet + '&tr=udp://tracker.test'] }],
    },
    {
      name: 'Two',
      downloads: [
        { title: 'Example Game', uris: [magnet.toUpperCase().replace('MAGNET:', 'magnet:')] },
        { title: 'Example Game v2', uris: [magnet] },
      ],
    },
  ]);
  assert.equal(merged.games.length, 2);
  assert.equal(merged.games[0].links.length, 1);
  assert.equal(merged.games[0].occurrences, 2);
  assert.equal(torrentHash(magnet), hash);
});
test('catalog publishes only TorBox-verified entries, writes duplicate report, searches and preserves prior catalog on source failure', async () => {
  const dir = await temp();
  let broken = false;
  const transport = async () =>
    broken
      ? new Response('Unavailable', { status: 503 })
      : Response.json({
          name: 'Fixture',
          downloads: [
            { title: 'Cached Game', uris: [magnet] },
            { title: 'Not Cached', uris: [`magnet:?xt=urn:btih:${'f'.repeat(40)}`] },
            { title: 'Cached Game', uris: [magnet] },
          ],
        });
  const config = {
    sourceUrls: ['https://sources.test/games.json'],
    torboxApiKey: 'fixture-key',
    cachedOnly: true,
  };
  const catalog = new Catalog(dir, async () => config, {
    transport,
    apiFactory: () => ({ cached: async (kind) => new Set(kind === 'torrents' ? [hash] : []) }),
  });
  await catalog.sync(true);
  assert.equal(catalog.state.phase, 'ready');
  assert.equal(catalog.search('cached game').total, 1);
  assert.equal(catalog.search('not cached').total, 0);
  const merged = JSON.parse(await fs.readFile(path.join(dir, 'catalog.json'), 'utf8'));
  assert.equal(merged.games.length, 1);
  assert.equal(merged.duplicates.length, 1);
  broken = true;
  await catalog.sync(true);
  assert.equal(catalog.state.phase, 'error');
  assert.equal(catalog.games.length, 1);
});
test('TorBox requests use authentication and JSON batch payloads', async () => {
  let observed;
  const api = new TorBox('fixture-key', async (url, options) => {
    observed = { url: String(url), ...options };
    return Response.json({ success: true, data: { [hash]: { hash } } });
  });
  assert.equal((await api.cached('torrents', [hash])).has(hash), true);
  assert.equal(observed.method, 'POST');
  assert.equal(observed.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(observed.body).hashes, [hash]);
});
test('extractor removes wrapper nesting and rejects path traversal before extraction', async () => {
  const dir = await temp();
  const archive = path.join(dir, 'game.zip');
  const output = path.join(dir, 'game');
  await fs.writeFile(archive, zip('Game/Game/Game.exe', 'fixture, never executed'));
  await extractArchive(archive, output);
  await flatten(output);
  assert.equal(await fs.readFile(path.join(output, 'Game.exe'), 'utf8'), 'fixture, never executed');
  await fs.writeFile(path.join(dir, 'bad.zip'), zip('../outside.txt', 'bad'));
  await assert.rejects(
    extractArchive(path.join(dir, 'bad.zip'), path.join(dir, 'bad')),
    /unsafe path/,
  );
  assert.throws(() => within(output, path.join(output, '..', 'escape')), /escapes/);
});

test('rate limits preserve verified results and schedule a resumable catalog retry', async () => {
  const dir = await temp();
  const config = {
    sourceUrls: ['https://sources.test/games.json'],
    torboxApiKey: 'fixture-key',
    cachedOnly: true,
    enabledDownloadServices: ['torbox'],
  };
  const catalog = new Catalog(dir, async () => config, {
    transport: async () =>
      Response.json({
        downloads: [
          { title: 'Cached Game', uris: [magnet] },
          { title: 'Web Game', uris: ['https://host.test/game.zip'] },
        ],
      }),
    apiFactory: () => ({
      cached: async (kind) => {
        if (kind === 'torrents') return new Set([hash]);
        const error = new Error('Rate limited');
        error.status = 429;
        error.retryAfter = 60000;
        throw error;
      },
    }),
  });
  try {
    await catalog.sync(true);
    assert.equal(catalog.state.phase, 'waiting');
    assert.equal(catalog.search('Cached Game').total, 1);
    assert.ok(catalog.retryTimer);
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'catalog.json'), 'utf8'));
    assert.equal(saved.games.length, 1);
    assert.equal(saved.pending.length, 2);
  } finally {
    clearTimeout(catalog.retryTimer);
  }
});
test('download resumes a partial file and verifies its final length', async () => {
  const dir = await temp();
  const target = path.join(dir, 'part.bin');
  await fs.writeFile(target + '.part', 'abc');
  await downloadFile(
    'https://cdn.test/file',
    target,
    6,
    undefined,
    () => {},
    async (_url, options) => {
      assert.equal(options.headers.Range, 'bytes=3-');
      return new Response('def', {
        status: 206,
        headers: { 'Content-Range': 'bytes 3-5/6', 'Content-Length': '3' },
      });
    },
  );
  assert.equal(await fs.readFile(target, 'utf8'), 'abcdef');
});
test('direct Pixeldrain queue downloads and installs a game without any TorBox account', async (t) => {
  const dir = await temp();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archive = zip('Wrapper/Fixture.exe', 'fixture, never executed');
  const config = {
    downloadPath: path.join(dir, 'Games'),
    enabledDownloadServices: ['direct'],
    cachedOnly: true,
    autoInstall: false,
    transferTimeoutMinutes: 5,
  };
  const game = {
    id: 'direct-fixture',
    name: 'Direct Fixture',
    links: [{ uri: 'https://pixeldrain.com/u/fixture', services: ['direct'] }],
  };
  const library = new Library(() => config);
  const queue = new Downloads(dir, () => config, { byId: new Map([[game.id, game]]) }, library, {
    apiFactory: () => assert.fail('No TorBox request is allowed'),
    transport: async (url) =>
      String(url).endsWith('/info')
        ? Response.json({ id: 'fixture', name: 'game.zip', size: archive.length })
        : new Response(archive, { headers: { 'Content-Length': String(archive.length) } }),
  });
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Direct queue timed out')), 10000);
    queue.on('change', () => {
      if (['failed', 'completed'].includes(queue.jobs[0]?.status)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await queue.start(game.id);
  await finished;
  await queue.persistQueue;
  assert.equal(queue.jobs[0].status, 'completed', queue.jobs[0].message);
  assert.equal(queue.jobs[0].service, 'direct');
  assert.equal(library.items.length, 1);
});
test('complete queue downloads, extracts, flattens, and registers a portable game', async () => {
  const dir = await temp();
  const config = {
    downloadPath: path.join(dir, 'Games'),
    torboxApiKey: 'fixture-key',
    cachedOnly: true,
    autoInstall: false,
    transferTimeoutMinutes: 5,
  };
  const archive = zip('Outer/Inner/Fixture.exe', 'fixture, never executed');
  const game = { id: 'fixture-game', name: 'Fixture Game', links: [{ uri: magnet }] };
  const library = new Library(async () => config);
  let automaticSettings;
  const jobs = new Downloads(
    dir,
    async () => config,
    { byId: new Map([[game.id, game]]) },
    library,
    {
      setupGame: async (settings) => {
        automaticSettings = settings;
        return { folder: settings.folder, executable: settings.file, steam: { status: 'added' } };
      },
      reviewSetup: async () => assert.fail('detected launcher should not need interactive setup'),
      transport: async () =>
        new Response(archive, { headers: { 'Content-Length': String(archive.length) } }),
      apiFactory: () => ({
        create: async () => ({ kind: 'torrents', id: 1 }),
        info: async () => ({
          download_finished: true,
          files: [{ id: 0, name: 'release.zip', size: archive.length }],
        }),
        downloadLink: async () => 'https://cdn.test/archive',
      }),
    },
  );
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Queue test timed out')), 15000);
    jobs.on('change', () => {
      if (['completed', 'failed'].includes(jobs.jobs[0]?.status)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await jobs.start(game.id);
  await finished;
  assert.equal(automaticSettings.name, 'Fixture Game');
  assert.equal(automaticSettings.folder, path.join(config.downloadPath, 'Fixture Game'));
  assert.equal(path.basename(automaticSettings.file), 'Fixture.exe');
  assert.equal(jobs.jobs[0].status, 'completed', jobs.jobs[0].message);
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].status, 'installed');
  assert.equal(path.basename(library.items[0].executable), 'Fixture.exe');
});
