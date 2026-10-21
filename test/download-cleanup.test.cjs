const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Downloads } = require('../src/core/downloads.cjs');
const day = 86400000;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-cleanup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const downloads = new Downloads(root, () => ({}), {}, {});
  const now = Date.now();
  let index = 0;
  async function job(status, age = 2 * day) {
    const item = {
      id: `00000000-0000-0000-0000-${String(++index).padStart(12, '0')}`,
      root,
      status,
      received: 7,
      progress: 50,
    };
    const stage = path.join(root, '.mamba-downloads', item.id);
    const raw = path.join(stage, 'raw');
    const file = path.join(raw, 'game.part');
    await fs.mkdir(raw, { recursive: true });
    await fs.writeFile(file, 'partial');
    for (const name of [file, raw, stage])
      await fs.utimes(name, new Date(now - age), new Date(now - age));
    downloads.jobs.push(item);
    return { item, stage, file };
  }
  return { root, downloads, now, job };
}
test('startup clears only stale unfinished staging and persists a retryable queue entry', async (t) => {
  const { root, downloads, now, job } = await fixture(t);
  const stale = await job('failed');
  const recent = await job('paused', day - 1000);
  const completed = await job('completed');
  const setup = await job('needs-setup');
  const active = await job('paused');
  downloads.controllers.set(active.item.id, new AbortController());
  const install = path.join(root, 'Installed Game');
  await fs.mkdir(install);
  await fs.writeFile(path.join(install, 'game.exe'), 'keep');
  stale.item.folder = install;
  await downloads.clearStalePartials(now);
  await assert.rejects(fs.stat(stale.stage), { code: 'ENOENT' });
  for (const kept of [recent, completed, setup, active])
    assert.equal(await fs.readFile(kept.file, 'utf8'), 'partial');
  assert.equal(await fs.readFile(path.join(install, 'game.exe'), 'utf8'), 'keep');
  assert.equal(stale.item.status, 'cancelled');
  assert.equal(stale.item.received, 0);
  const saved = JSON.parse(await fs.readFile(downloads.file));
  assert.equal(saved[0].received, 0);
});
test('recent nested changes and exact 24 hour boundary protect old folders', async (t) => {
  const { downloads, now, job } = await fixture(t);
  const nested = await job('failed');
  await fs.utimes(nested.file, new Date(now - 1000), new Date(now - 1000));
  const boundary = await job('cancelled', day);
  await downloads.clearStalePartials(now);
  for (const kept of [nested, boundary])
    assert.equal(await fs.readFile(kept.file, 'utf8'), 'partial');
});
test('junctions cannot cause cleanup outside the owned staging folder', async (t) => {
  const { root, downloads, now, job } = await fixture(t);
  const stale = await job('failed');
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep'), 'keep');
  await fs.symlink(outside, path.join(stale.stage, 'linked'), 'junction');
  await fs.utimes(stale.stage, new Date(now - 2 * day), new Date(now - 2 * day));
  await downloads.clearStalePartials(now);
  assert.equal(await fs.readFile(stale.file, 'utf8'), 'partial');
  assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'keep');
});
test('recovery checkpoints protect stale staging even when downloads need attention', async (t) => {
  const { downloads, now, job } = await fixture(t);
  for (const status of ['waiting-retry', 'failed', 'paused']) {
    const item = await job(status);
    item.item.recovery = { enabled: true, nextRetryAt: now + 1000 };
    await downloads.clearStalePartials(now);
    assert.equal(await fs.readFile(item.file, 'utf8'), 'partial');
  }
});
