const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const {
  CreamInstaller,
  download,
  validateRelease,
  newer,
} = require('../src/core/cream-installer.cjs');
const repo = 'https://github.com/FroggMaster/CreamInstaller';
function release(version, bytes) {
  return {
    version,
    url: `${repo}/releases/download/${version}/CreamInstaller.exe`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-cream-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const resources = path.join(directory, 'bundle');
  await fs.mkdir(resources);
  const bytes = Buffer.from('bundled executable fixture');
  await fs.writeFile(path.join(resources, 'CreamInstaller.exe'), bytes);
  const pin = release('v5.2.0.0', bytes);
  const launched = [];
  const config = { automaticUpdates: true };
  const params = {
    directory,
    resources,
    getConfig: async () => config,
    release: pin,
    launch: async (file) => launched.push(file),
    transport: async () => assert.fail('unexpected network'),
    ...options,
  };
  return {
    directory,
    resources,
    pin,
    bytes,
    launched,
    config,
    params,
    tool: new CreamInstaller(params),
  };
}
function apiResponse(pin) {
  return {
    ok: true,
    json: async () => ({
      tag_name: pin.version,
      assets: [
        {
          name: 'CreamInstaller.exe',
          browser_download_url: pin.url,
          digest: 'sha256:' + pin.sha256,
          size: pin.size,
        },
      ],
    }),
  };
}

test('bundled executable opens offline from writable storage and survives restart', async (t) => {
  const f = await fixture(t);
  await f.tool.open();
  assert.equal(f.launched.length, 1);
  assert.notEqual(path.dirname(f.launched[0]), f.resources);
  assert.deepEqual(await fs.readFile(f.launched[0]), f.bytes);
  const restored = new CreamInstaller(f.params);
  await restored.open();
  assert.equal(restored.state.version, f.pin.version);
});

test('verified updates switch the next launch to the latest version and retain the working bundle', async (t) => {
  const f = await fixture(t);
  await f.tool.initialize();
  const oldFile = f.tool.executable(f.tool.current);
  const bytes = Buffer.from('updated executable fixture');
  const next = release('v5.3.0.0', bytes);
  let requests = 0;
  f.tool.fetch = async (url) => {
    requests++;
    return url.endsWith('/latest') ? apiResponse(next) : new Response(bytes);
  };
  const state = await f.tool.check();
  assert.equal(state.status, 'ready');
  assert.equal(state.version, next.version);
  await f.tool.open();
  assert.deepEqual(await fs.readFile(f.launched[0]), bytes);
  assert.deepEqual(await fs.readFile(oldFile), f.bytes);
  await f.tool.check();
  assert.equal(requests, 2, 'automatic checks are limited to once daily');
  const restored = new CreamInstaller(f.params);
  await restored.initialize();
  assert.equal(restored.state.version, next.version);
});

test('disabled automatic updates make no requests; manual checks still work', async (t) => {
  const f = await fixture(t);
  f.config.automaticUpdates = false;
  await f.tool.check();
  let requests = 0;
  f.tool.fetch = async () => {
    requests++;
    return apiResponse(f.pin);
  };
  await f.tool.check(true);
  assert.equal(requests, 1);
});

test('a failed or corrupt update keeps the previous executable usable and removes partial files', async (t) => {
  const f = await fixture(t);
  await f.tool.initialize();
  const next = release('v5.3.0.0', Buffer.from('expected executable fixture'));
  f.tool.fetch = async (url) =>
    url.endsWith('/latest') ? apiResponse(next) : new Response('wrong bytes');
  const state = await f.tool.check(true);
  assert.equal(state.status, 'error');
  assert.equal(state.version, f.pin.version);
  await f.tool.open();
  assert.deepEqual(await fs.readFile(f.launched[0]), f.bytes);
  const files = await fs.readdir(path.dirname(f.tool.executable(next)));
  assert.equal(
    files.some((name) => name.endsWith('.tmp') || name.endsWith('.exe')),
    false,
  );
  f.tool.fetch = async () => {
    throw Error('offline');
  };
  assert.equal((await f.tool.check(true)).status, 'error');
  assert.equal((await f.tool.open()).version, f.pin.version);
});

test('download rejects unexpected executable sources and unverified release metadata', async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { url: 'https://example.test/tool.exe' },
    { sha256: '' },
    { size: -1 },
    { version: '../escape' },
  ])
    assert.throws(() => validateRelease({ ...f.pin, ...patch }), /could not be verified/);
  await assert.rejects(
    download({ ...f.pin, sha256: '' }, path.join(f.directory, 'bad.exe')),
    /could not be verified/,
  );
  assert.equal(newer('v5.10.0.0', 'v5.2.0.0'), true);
  assert.equal(newer('v5.2.0.0', 'v5.3.0.0'), false);
});

test('overlapping checks share one download and corrupt bundled executables never launch', async (t) => {
  const f = await fixture(t);
  let requests = 0;
  f.tool.fetch = async () => {
    requests++;
    return apiResponse(f.pin);
  };
  await Promise.all([f.tool.check(true), f.tool.check(true)]);
  assert.equal(requests, 1);
  const other = await fixture(t);
  await fs.writeFile(path.join(other.resources, 'CreamInstaller.exe'), 'damaged');
  await assert.rejects(other.tool.open(), /missing or damaged/);
  assert.deepEqual(other.launched, []);
});
