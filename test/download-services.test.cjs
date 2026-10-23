const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const {
  DirectDownloads,
  RealDebrid,
  candidates,
  chooseService,
  directKind,
} = require('../src/core/download-services.cjs');
const { Catalog } = require('../src/core/catalog.cjs');
const { downloadFile } = require('../src/core/downloads.cjs');
const { validateSettings } = require('../src/core/config-transfer.cjs');
const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);
test('service selection enforces explicit service and host preferences', () => {
  const link = { uri: 'https://pixeldrain.com/u/fixture', services: ['direct', 'torbox'] };
  const config = {
    torboxApiKey: 'key',
    enabledDownloadServices: ['direct', 'torbox'],
    preferredDownloadService: 'torbox',
  };
  assert.equal(chooseService(link, config), 'torbox');
  assert.equal(chooseService(link, config, 'direct'), 'direct');
  assert.throws(
    () => chooseService(link, { ...config, disabledDownloadHosts: ['pixeldrain.com'] }),
    /disabled/,
  );
  assert.throws(
    () => chooseService(link, { enabledDownloadServices: ['realdebrid'] }, 'realdebrid'),
    /Enable/,
  );
  assert.equal(directKind('https://example.test/game-page'), null);
  assert.equal(directKind('https://example.test/game.zip'), 'https');
  assert.deepEqual(
    candidates(
      { uri: magnet },
      { realDebridApiKey: 'fixture', enabledDownloadServices: ['realdebrid'] },
    ),
    ['realdebrid'],
  );
});
test('Pixeldrain files and lists resolve to individual byte-checked downloads', async () => {
  const calls = [];
  const service = new DirectDownloads(async (url) => {
    calls.push(String(url));
    return Response.json(
      String(url).includes('/list/')
        ? {
            files: [
              { id: 'one', name: 'game.7z.001', size: 3 },
              { id: 'two', name: 'game.7z.002', size: 2 },
            ],
          }
        : { id: 'one', name: 'game.zip', size: 5 },
    );
  });
  let remote = await service.create('https://pixeldrain.com/u/one');
  assert.equal((await service.info(remote.kind, remote.id)).files[0].size, 5);
  remote = await service.create('https://pixeldrain.com/l/listid');
  assert.equal((await service.info(remote.kind, remote.id)).files.length, 2);
  assert.equal(
    await service.downloadLink(remote.kind, remote.id, 'two'),
    'https://pixeldrain.com/api/file/two?download',
  );
  assert.equal(calls.length, 2);
});
test('Real-Debrid selects torrent files and matches file IDs to unrestricted links', async () => {
  const calls = [];
  let selected = false;
  const service = new RealDebrid('fixture-secret', async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    if (url.endsWith('addMagnet')) return Response.json({ id: 'rd1' }, { status: 201 });
    if (url.includes('selectFiles')) {
      assert.equal(options.body.get('files'), 'all');
      selected = true;
      return new Response(null, { status: 204 });
    }
    if (url.includes('torrents/info'))
      return Response.json(
        selected
          ? {
              status: 'downloaded',
              progress: 100,
              files: [{ id: 7, path: '/release/game.zip', bytes: 5, selected: 1 }],
              links: ['https://rd.test/file'],
            }
          : { status: 'waiting_files_selection' },
      );
    if (url.endsWith('unrestrict/link')) {
      assert.equal(options.body.get('link'), 'https://rd.test/file');
      return Response.json({ download: 'https://cdn.test/game.zip' });
    }
    throw Error('Unexpected request');
  });
  const remote = await service.create(magnet);
  assert.equal((await service.info(remote.kind, remote.id)).progress, 0);
  const info = await service.info(remote.kind, remote.id);
  assert.equal(info.download_finished, true);
  assert.equal(info.files[0].name, 'release/game.zip');
  assert.equal(await service.downloadLink(remote.kind, remote.id, 7), 'https://cdn.test/game.zip');
  assert.equal(calls.length, 5);
});
test('direct-only catalogs work without a TorBox key and respect host/source selections', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-services-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let config = {
    sourceUrls: ['https://sources.test/one', 'https://sources.test/disabled'],
    disabledSourceUrls: ['https://sources.test/disabled'],
    enabledDownloadServices: ['direct'],
    cachedOnly: true,
  };
  let requests = 0;
  const catalog = new Catalog(dir, () => config, {
    transport: async (url) => {
      requests++;
      assert.equal(url, 'https://sources.test/one');
      return Response.json({
        name: 'Fixture',
        downloads: [
          { title: 'Direct Game', uris: ['https://pixeldrain.com/u/fileid'] },
          { title: 'Webpage', uris: ['https://example.test/product'] },
        ],
      });
    },
    apiFactory: () => ({ cached: () => assert.fail('TorBox must not be called') }),
  });
  await catalog.sync(true);
  assert.equal(catalog.state.phase, 'ready');
  assert.equal(catalog.games.length, 1);
  assert.deepEqual(catalog.games[0].links[0].services, ['direct']);
  const resolved = await catalog.resolveGame(catalog.searchIndex[0].id);
  assert.equal(resolved.best.available, true);
  assert.deepEqual(resolved.best.services, ['direct']);
  config = { ...config, disabledDownloadHosts: ['pixeldrain.com'] };
  await catalog.sync(true);
  assert.equal(catalog.games.length, 0);
  assert.equal(requests, 2);
});
test('HTML masquerading as a download never replaces a retained partial file', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-html-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'game.zip');
  await fs.writeFile(file + '.part', 'abc');
  await assert.rejects(
    downloadFile(
      'https://example.test/game.zip',
      file,
      6,
      undefined,
      () => {},
      async () => new Response('<html>bad</html>', { headers: { 'Content-Type': 'text/html' } }),
    ),
    /webpage/,
  );
  assert.equal(await fs.readFile(file + '.part', 'utf8'), 'abc');
});
test('service configuration validates providers without dropping selection or keys', () => {
  const value = {
    enabledDownloadServices: ['direct', 'realdebrid'],
    realDebridApiKey: 'fixture',
    preferredDownloadService: 'direct',
    disabledDownloadHosts: ['gofile.io'],
    disabledSourceUrls: ['https://source.test/feed.json'],
  };
  assert.deepEqual(validateSettings(value), value);
  assert.throws(() => validateSettings({ enabledDownloadServices: ['fake'] }));
  assert.throws(() => validateSettings({ disabledSourceUrls: ['file:///private'] }));
});
test('the selected per-download service reaches the queue through the background service', async () => {
  const { BackgroundService } = require('../src/core/background-service.cjs');
  const service = new BackgroundService(() => {});
  let received;
  service.libraryState = { restore: async () => {} };
  service.catalog = {
    getGame: () => ({ name: 'Fixture', options: [{ gameId: 'release', linkIndex: 2 }] }),
  };
  service.downloads = {
    start: async (...args) => {
      received = args;
      return 'job';
    },
  };
  assert.equal(
    await service.call('downloads:start', ['release', 2, 'steam:10', 'realdebrid']),
    'job',
  );
  assert.deepEqual(received, ['release', 2, 'Fixture', 'realdebrid']);
});
