const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { downloadFile } = require('../lib/downloads.cjs');
const { explain, Issues } = require('../lib/issues.cjs');
async function fixture(t, partial = '') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'game.rar');
  if (partial) await fs.writeFile(file + '.part', partial);
  return file;
}
test('terminated stream resumes from flushed disk bytes and finalizes', async t => {
  const file = await fixture(t); let calls = 0;
  await downloadFile('https://cdn.test', file, 6, undefined, () => {}, async (_url, options) => {
    if (++calls === 1) return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from('abc')); setTimeout(() => controller.error(new TypeError('terminated', { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) })), 30); }
    }), { headers: { 'Content-Length': '6' } });
    assert.equal(options.headers.Range, 'bytes=3-');
    return new Response('def', { status: 206, headers: { 'Content-Range': 'bytes 3-5/6', 'Content-Length': '3' } });
  });
  assert.equal(calls, 2); assert.equal(await fs.readFile(file, 'utf8'), 'abcdef');
  await assert.rejects(fs.stat(file + '.part'), { code: 'ENOENT' });
});
test('clean short responses have bounded retries and retain saved bytes', async t => {
  const file = await fixture(t, 'abc'); let calls = 0;
  await assert.rejects(downloadFile('https://cdn.test', file, 6, undefined, () => {}, async () => {
    calls++; return new Response('', { status: 206, headers: { 'Content-Range': 'bytes 3-5/6' } });
  }), error => error.code === 'DOWNLOAD_INCOMPLETE' && error.download.received === 3 && error.download.attempt === 3);
  assert.equal(calls, 3); assert.equal(await fs.readFile(file + '.part', 'utf8'), 'abc');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});
test('invalid ranges, ignored ranges and 416 preserve partial data', async t => {
  const file = await fixture(t, 'abc');
  for (const response of [new Response('abcdef'), new Response('def', { status: 206, headers: { 'Content-Range': 'bytes 3-5/7' } }), new Response('', { status: 416 })]) {
    await assert.rejects(downloadFile('https://cdn.test', file, 6, undefined, () => {}, async () => response));
    assert.equal(await fs.readFile(file + '.part', 'utf8'), 'abc');
  }
});
test('complete partial finalizes offline, while abort preserves it', async t => {
  const file = await fixture(t, 'abcdef'); const controller = new AbortController(); controller.abort();
  await assert.rejects(downloadFile('https://cdn.test', file, 6, controller.signal, () => {}));
  assert.equal(await fs.readFile(file + '.part', 'utf8'), 'abcdef');
  await downloadFile('https://cdn.test', file, 6, undefined, () => {}, () => assert.fail('complete partial needs no request'));
  assert.equal(await fs.readFile(file, 'utf8'), 'abcdef');
});
test('unknown expected length uses the complete range size', async t => {
  const file = await fixture(t, 'abc');
  await downloadFile('https://cdn.test', file, 0, undefined, () => {}, async () => new Response('def', { status: 206, headers: { 'Content-Range': 'bytes 3-5/6' } }));
  assert.equal(await fs.readFile(file, 'utf8'), 'abcdef');
});
test('oversized responses never finalize and retain the valid prefix', async t => {
  const file = await fixture(t, 'abc');
  await assert.rejects(downloadFile('https://cdn.test', file, 6, undefined, () => {}, async () => new Response('defg', { status: 206, headers: { 'Content-Range': 'bytes 3-5/6' } })), /exceeds expected size/);
  assert.equal(await fs.readFile(file + '.part', 'utf8'), 'abc');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});
test('terminated failures are classified and exported without link credentials', () => {
  assert.equal(explain(new Error('terminated')).code, 'connection');
  const issues = new Issues(); issues.add(new Error('terminated https://cdn.test/private?token=secret'));
  assert.equal(issues.diagnostics()[0].message, 'terminated [link]');
});
