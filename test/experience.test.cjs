const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LibraryState, storageInfo, ensureSpace, sizeBytes } = require('../src/core/experience.cjs');
const { Library } = require('../src/core/library.cjs');
const { Issues } = require('../src/core/issues.cjs');

test('successful artwork requests resolve only saved artwork overload warnings', () => {
  const issues = new Issues();
  const old = issues.add(Error('Mamba is busy. Try again shortly.'), 'catalog:artwork');
  const other = issues.add(Error('A different failure'), 'catalog:artwork');
  assert.equal(issues.resolveArtworkOverload(), true);
  assert.equal(old.resolved, true);
  assert.equal(other.resolved, false);
  assert.equal(issues.resolveArtworkOverload(), false);
  const current = issues.add(Error('Mamba is busy. Try again shortly.'), 'downloads:start');
  assert.equal(issues.resolveArtworkOverload(), false);
  assert.equal(current.resolved, false);
});
const { rankOptions } = require('../src/core/search.cjs');
const { Downloads } = require('../src/core/downloads.cjs');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-experience-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('imports existing games without moving them, and remembers favorites and play history', async (t) => {
  const dir = await fixture(t),
    games = path.join(dir, 'games'),
    external = path.join(dir, 'external');
  await fs.mkdir(games);
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'game.exe'), 'fixture');
  const state = new LibraryState(dir);
  await state.load();
  await state.addImport(external);
  const library = new Library(
    async () => ({ downloadPath: games, automaticGameDetection: false }),
    {
      imports: () => state.data.imports,
    },
  );
  const items = await library.scan();
  assert.equal(items.length, 1);
  assert.equal(items[0].imported, true);
  assert.equal(items[0].folder, external);
  await state.favorite(items[0], true);
  await state.played(items[0]);
  const restored = new LibraryState(dir);
  await restored.load();
  assert.equal(restored.decorate(items)[0].favorite, true);
  assert.ok(restored.decorate(items)[0].lastPlayed);
  await restored.forget(external);
  assert.equal(restored.data.imports.length, 0);
  assert.equal((await fs.stat(path.join(external, 'game.exe'))).isFile(), true);
});
test('space estimates account for archives and setup; low space blocks starting', async (t) => {
  const dir = await fixture(t);
  t.mock.method(fs, 'statfs', async () => ({ bavail: 500, bsize: 1024 }));
  assert.equal(sizeBytes('1.5 GB'), 1500000000);
  assert.equal(sizeBytes('1 GiB'), 1024 ** 3);
  const info = await storageInfo(dir, 100, { multiplier: 3, reserve: 0 });
  assert.equal(info.required, 300);
  assert.equal(info.hasSpace, true);
  await assert.rejects(ensureSpace(dir, 1024 ** 3), (error) => error.code === 'ENOSPC');
});
test('pausing a transfer retains its queue entry and does not convert it to cancelled', async (t) => {
  const dir = await fixture(t);
  const downloads = new Downloads(dir, async () => ({}), {}, {});
  const job = { id: '11111111-1111-4111-8111-111111111111', status: 'queued', name: 'Fixture' };
  downloads.jobs = [job];
  let started;
  const downloading = new Promise((resolve) => {
    started = resolve;
  });
  downloads.execute = async (job, signal) => {
    await downloads.update(job, { status: 'downloading' });
    await new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
      started();
    });
  };
  const pumping = downloads.pump();
  await downloading;
  await downloads.pause(job.id);
  await pumping;
  assert.equal(job.status, 'paused');
  assert.equal(downloads.jobs.length, 1);
  assert.equal(job.stage, 'downloading');
});
test('language and release preferences guide ranking without hiding alternatives', () => {
  const options = [
    { release: 'Example [ENG] Portable', cached: true, sources: ['a'] },
    { release: 'Example [RUS] Repack', cached: true, sources: ['b'] },
  ];
  assert.match(
    rankOptions(options, { preferredLanguage: 'russian', preferredRelease: 'repack' })[0].release,
    /RUS/,
  );
  assert.equal(rankOptions(options).length, 2);
});
test('OnlineFix preference ranks labeled full games without claiming compatibility', () => {
  const options = [
    { release: 'Example [ENG] Portable', cached: true, sources: ['a'] },
    { release: 'Example [ENG] Online-Fix', sources: ['b'] },
    { release: 'Example [ENG] OnlineFix Update only', sources: ['c'] },
    { release: 'Example [Linux ENG] OnlineFix', sources: ['d'] },
  ];
  assert.equal(rankOptions(options)[0].release, options[0].release);
  const ranked = rankOptions(options, { preferredRelease: 'onlinefix' });
  assert.equal(ranked[0].release, options[1].release);
  assert.equal(ranked.length, options.length);
  assert.ok(ranked[0].reasons.some((reason) => reason.includes('multiplayer unverified')));
  assert.equal(
    require('../src/core/config-transfer.cjs').validateSettings({ preferredRelease: 'onlinefix' })
      .preferredRelease,
    'onlinefix',
  );
});

test('issue messages and exported diagnostics redact credentials and links', () => {
  const issues = new Issues(),
    secret = 'super-secret-fixture-token';
  const item = issues.add(
    Error('401 ' + secret + ' https://example.com/private?token=' + secret),
    'downloads',
    [secret],
  );
  assert.equal(item.code, 'authentication');
  assert.ok(!item.message.includes(secret));
  assert.ok(!item.message.includes('example.com'));
  const exported = JSON.stringify(issues.diagnostics());
  assert.ok(!exported.includes(secret));
  assert.ok(!exported.includes('example.com'));
  assert.equal(issues.diagnostics()[0].message, item.message);
  issues.resolve(item.id);
  assert.equal(issues.items[0].resolved, true);
});
