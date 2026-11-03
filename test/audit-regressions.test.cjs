const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Artwork } = require('../src/core/artwork.cjs');
const { Library, unpack, run, sevenZipPath } = require('../src/core/library.cjs');
const { Downloads, downloadFile } = require('../src/core/downloads.cjs');
const { createConfigStore } = require('../src/main/config-store.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function metadataPath(file) {
  return path.join(
    path.dirname(file),
    '.mamba-transfer',
    createHash('sha256').update(path.basename(file)).digest('hex') + '.json',
  );
}

test('moving an installation keeps it discoverable despite its stale manifest executable', async (t) => {
  const root = await fixture(t);
  const old = path.join(root, 'Old');
  await fs.mkdir(old);
  await fs.writeFile(path.join(old, 'game.exe'), 'game');
  await fs.writeFile(
    path.join(old, '.mamba-game.json'),
    JSON.stringify({ name: 'Game', executable: path.join(old, 'game.exe') }),
  );
  const moved = path.join(root, 'Moved');
  await fs.rename(old, moved);
  const library = new Library(async () => ({ automaticGameDetection: false, downloadPath: root }));
  await library.scan();
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].executable, path.join(moved, 'game.exe'));
});

test('transient artwork failures recover after a short backoff instead of a full day', async (t) => {
  const root = await fixture(t);
  let calls = 0;
  const catalog = {
    searchIndex: [{ id: 'game', name: 'Game', cover: 'https://example.test/art.png' }],
  };
  const transport = async () =>
    ++calls === 1
      ? new Response('', { status: 503 })
      : new Response('image', { headers: { 'content-type': 'image/png' } });
  assert.equal(await new Artwork(root, catalog, transport).get('game'), null);
  assert.equal(await new Artwork(root, catalog, transport).get('game'), null);
  assert.equal(calls, 1);
  const directory = path.join(root, 'artwork');
  const cache = path.join(directory, (await fs.readdir(directory))[0]);
  const saved = JSON.parse(await fs.readFile(cache));
  await fs.writeFile(cache, JSON.stringify({ ...saved, at: Date.now() - 61000 }));
  assert.match(await new Artwork(root, catalog, transport).get('game'), /^data:image\/png;base64,/);
  assert.equal(calls, 2);
});

test('validator-free partials restart without combining two same-size file versions', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'game.bin');
  await fs.writeFile(file + '.part', 'old');
  await downloadFile(
    'https://example.test/game',
    file,
    6,
    undefined,
    () => {},
    async (_url, options) => {
      assert.equal(options.headers.Range, undefined);
      return new Response('newnew', { headers: { 'content-length': '6' } });
    },
  );
  assert.equal(await fs.readFile(file, 'utf8'), 'newnew');
  await assert.rejects(fs.stat(metadataPath(file) + '.partial-backup'), { code: 'ENOENT' });
});

test('a failed validator-free restart retains the original partial in transfer storage', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'game.bin');
  await fs.writeFile(file + '.part', 'old');
  await assert.rejects(
    downloadFile(
      'https://example.test/game',
      file,
      6,
      undefined,
      () => {},
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(Error('broken body'));
            },
          }),
          { headers: { 'content-length': '6' } },
        ),
    ),
  );
  assert.equal(await fs.readFile(metadataPath(file) + '.partial-backup', 'utf8'), 'old');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('all final and temporary download paths are checked before transferring any file', async (t) => {
  const root = await fixture(t);
  for (const names of [
    ['game.bin', 'game.bin.part'],
    ['game.bin.part', 'game.bin'],
    ['game', 'game/asset.bin'],
  ]) {
    let links = 0;
    const config = {
      downloadPath: root,
      automaticGameDetection: false,
      enabledDownloadServices: ['torbox'],
      torboxApiKey: 'test',
      keepArchives: true,
    };
    const queue = new Downloads(root, () => config, {}, new Library(() => config), {
      checkDisk: async () => ({}),
      apiFactory: () => ({
        create: async () => ({ kind: 'torrents', id: 1 }),
        info: async () => ({
          download_finished: true,
          files: names.map((name, id) => ({ name, id, size: 6 })),
        }),
        downloadLink: async () => {
          links++;
          return 'https://example.test/game';
        },
      }),
      transport: async () => new Response('123456'),
    });
    t.after(() => queue.stop());
    const job = {
      id: randomUUID(),
      gameId: 'game',
      uri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
      name: 'Game',
      root,
      service: 'torbox',
      status: 'queued',
    };
    queue.jobs.push(job);
    await queue.pump();
    assert.equal(job.status, 'failed');
    assert.match(job.message, /colliding filenames/);
    assert.equal(links, 0);
  }
});

test('nested archive installation retains required sibling content', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'game.exe'), 'game');
  const wrapper = path.join(root, 'wrapper');
  await fs.mkdir(wrapper);
  await promisify(execFile)(sevenZipPath(), ['a', path.join(wrapper, 'inner.zip'), '.'], {
    cwd: source,
  });
  await fs.writeFile(path.join(wrapper, 'required.dat'), 'sidecar');
  const raw = path.join(root, 'raw');
  await fs.mkdir(raw);
  await promisify(execFile)(sevenZipPath(), ['a', path.join(raw, 'outer.zip'), '.'], {
    cwd: wrapper,
  });
  const payload = path.join(root, 'payload');
  const found = await unpack(raw, payload, {}, () => {});
  assert.equal(await fs.readFile(found.executable, 'utf8'), 'game');
  assert.equal(await fs.readFile(path.join(payload, 'required.dat'), 'utf8'), 'sidecar');
});

test('CLI and GUI settings updates preserve each other and restrict credential permissions', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'config.json');
  await fs.writeFile(file, '{}');
  const store = createConfigStore({
    app: { getPath: () => root },
    safeStorage: {},
    dataDirectory: () => root,
    reportIssue() {},
    onChange: async () => {},
    getInstalledGames: () => [],
  });
  const cli = (...args) =>
    promisify(execFile)(process.execPath, [path.resolve('tools/mamba-cli.cjs'), ...args], {
      env: { ...process.env, MAMBA_DATA_DIR: root },
    });
  const updates = Array.from({ length: 6 }, (_, i) =>
    cli('sources', 'add', `https://source${i}.test/feed.json`),
  );
  updates.push(
    store.updateConfig(async (config) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      config.torboxApiKey = 'private';
    }),
  );
  await Promise.all(updates);
  const saved = JSON.parse(await fs.readFile(file));
  assert.equal(saved.sourceUrls.length, 6);
  assert.equal(saved.torboxApiKey, 'private');
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await cli('config', 'set', 'autoInstall', 'false');
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test(
  'installed CLI discovers the GUI config under XDG_CONFIG_HOME on Linux',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await fixture(t);
    const folder = path.join(root, 'Mamba');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'config.json'), '{}');
    const env = { ...process.env, XDG_CONFIG_HOME: root };
    delete env.MAMBA_DATA_DIR;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [path.resolve('tools/mamba-cli.cjs'), 'config', 'path'],
      { env },
    );
    assert.equal(stdout.trim(), path.join(folder, 'config.json'));
  },
);
