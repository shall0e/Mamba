const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Catalog } = require('../src/core/catalog.cjs');
const signal = () => new AbortController().signal;
const feed = (title) =>
  JSON.stringify({
    name: 'Fixture',
    downloads: [{ title, uris: ['https://pixeldrain.com/u/fixture'] }],
  });

test('source cache survives restart and fetches only new URLs', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-source-cache-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const requests = [];
  const transport = async (url) => {
    requests.push(url);
    return new Response(feed(url), { headers: { ETag: 'v1' } });
  };
  const first = new Catalog(directory, async () => ({}), { transport });
  await first.readSource('https://sources.test/one', signal());
  const restarted = new Catalog(directory, async () => ({}), { transport });
  await restarted.readSource('https://sources.test/one', signal());
  await restarted.readSource('https://sources.test/two', signal());
  await restarted.readSource('https://sources.test/one', signal());
  assert.deepEqual(requests, ['https://sources.test/one', 'https://sources.test/two']);
});

test('explicit refresh uses validators, accepts 304 and caches changed content', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-source-cache-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let count = 0;
  const catalog = new Catalog(directory, async () => ({}), {
    transport: async (_url, options) => {
      count++;
      if (count === 1) return new Response(feed('Original'), { headers: { ETag: 'v1' } });
      assert.equal(options.headers['If-None-Match'], 'v1');
      if (count === 2) return new Response(null, { status: 304 });
      if (count === 3) return new Response(feed('Updated'), { headers: { ETag: 'v2' } });
      throw Error('Unexpected fetch');
    },
  });
  const url = 'https://sources.test/one';
  await catalog.readSource(url, signal());
  assert.equal((await catalog.readSource(url, signal(), true)).downloads[0].title, 'Original');
  assert.equal((await catalog.readSource(url, signal(), true)).downloads[0].title, 'Updated');
  assert.equal((await catalog.readSource(url, signal())).downloads[0].title, 'Updated');
  assert.equal(count, 3);
});

test('failed refresh preserves the last valid cached source', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-source-cache-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let fail = false;
  const catalog = new Catalog(directory, async () => ({}), {
    transport: async () => new Response(fail ? '<html>invalid</html>' : feed('Kept')),
  });
  const url = 'https://sources.test/one';
  await catalog.readSource(url, signal());
  fail = true;
  await assert.rejects(catalog.readSource(url, signal(), true));
  assert.equal((await catalog.readSource(url, signal())).downloads[0].title, 'Kept');
});
