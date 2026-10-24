const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { Downloads, downloadFile } = require('../src/core/downloads.cjs');
const { Library, atomicJson, flatten } = require('../src/core/library.cjs');
const {
  checkpoint,
  classify,
  backoff,
  retryAfter,
  MAX_RETRIES,
} = require('../src/core/recovery.cjs');
const { verifyFile, testArchive } = require('../src/core/verification.cjs');
const { Catalog } = require('../src/core/catalog.cjs');

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-automatic-'));
  let clock = 1000000;
  const config = {
    automaticRecovery: true,
    automaticGameDetection: false,
    downloadPath: dir,
    torboxApiKey: 'secret-api-key',
    realDebridApiKey: 'other-secret',
    archivePassword: 'private-password',
    enabledDownloadServices: ['torbox'],
    autoInstall: false,
    transferTimeoutMinutes: 5,
    keepArchives: true,
  };
  const job = {
    id: randomUUID(),
    gameId: 'fixture-release',
    uri: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
    name: 'Fixture Game',
    root: dir,
    service: 'torbox',
    status: 'queued',
    recovery: checkpoint(true),
  };
  let links = 0;
  const queue = new Downloads(dir, () => config, {}, new Library(() => config), {
    isOnline: () => true,
    now: () => clock,
    retryDelay: (_attempt, minimum) => Math.max(10000, minimum),
    checkDisk: async () => ({}),
    transport: async () =>
      new Response('abcdef', { headers: { 'Content-Length': '6', ETag: '"one"' } }),
    apiFactory: () => ({
      create: async () => ({ kind: 'torrents', id: 1 }),
      info: async () => ({
        download_finished: true,
        files: [{ id: 0, name: 'game.exe', size: 6 }],
      }),
      downloadLink: async () => `https://cdn.test/download?token=${++links}`,
    }),
    ...options,
  });
  queue.jobs.push(job);
  t.after(async () => {
    queue.stop();
    await queue.persistQueue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    config,
    job,
    queue,
    advance: () => {
      clock = (job.recovery.nextRetryAt || clock) + 1;
    },
    links: () => links,
  };
}

test('a transfer interrupted halfway resumes preserved bytes with If-Range after scheduled recovery', async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    transport: async (_url, options) => {
      calls++;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(Buffer.from('abc'));
            },
            pull(c) {
              setTimeout(
                () => c.error(Object.assign(Error('terminated'), { code: 'UND_ERR_SOCKET' })),
                20,
              );
            },
          }),
          { headers: { ETag: '"one"', 'Content-Length': '6' } },
        );
      if (calls < 4) return new Response('', { status: 503 });
      assert.equal(options.headers.Range, 'bytes=3-');
      assert.equal(options.headers['If-Range'], '"one"');
      return new Response('def', {
        status: 206,
        headers: { ETag: '"one"', 'Content-Range': 'bytes 3-5/6', 'Content-Length': '3' },
      });
    },
  });
  await f.queue.pump();
  assert.equal(f.job.status, 'waiting-retry');
  const saved = JSON.parse(await fs.readFile(f.queue.file));
  assert.equal(saved[0].recovery.nextRetryAt, f.job.recovery.nextRetryAt);
  assert.equal(await fs.readFile(f.job.activeFile + '.part', 'utf8'), 'abc');
  f.advance();
  await f.queue.pump();
  assert.equal(f.job.status, 'completed', f.job.message);
  assert.equal(await fs.readFile(path.join(f.job.folder, 'game.exe'), 'utf8'), 'abcdef');
  assert.equal(f.links(), 2);
});

test('scheduler refreshes expired links and wakes without manual pumping', async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    now: Date.now,
    retryDelay: () => 10,
    transport: async () =>
      ++calls === 1 ? new Response('', { status: 403 }) : new Response('abcdef'),
  });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Scheduled recovery did not run')), 3000);
    f.queue.on('change', () => {
      if (f.job.status === 'completed') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await f.queue.pump();
  await done;
  assert.equal(calls, 2);
  assert.equal(f.links(), 2);
});

test('Retry-After controls scheduling and offline waiting does not consume attempts', async (t) => {
  let connected = true;
  const f = await fixture(t, { isOnline: () => connected });
  const error = Object.assign(Error('Rate limited'), { status: 429, retryAfter: 60000 });
  await f.queue.recover(f.job, error);
  assert.equal(f.job.recovery.nextRetryAt, 1060000);
  assert.equal(f.job.recovery.retryCount, 1);
  connected = false;
  f.advance();
  await f.queue.pump();
  assert.equal(f.job.status, 'waiting-retry');
  assert.equal(f.job.recovery.retryCount, 1);
  connected = true;
  f.advance();
  await f.queue.pump();
  assert.equal(f.job.status, 'completed');
});

test('manual pause and cancel remain stopped across deadlines and reloads', async (t) => {
  for (const action of ['pause', 'cancel']) {
    const f = await fixture(t);
    await f.queue.recover(f.job, Object.assign(Error('Connection reset'), { code: 'ECONNRESET' }));
    await f.queue[action](f.job.id);
    f.advance();
    await f.queue.pump();
    assert.equal(f.job.status, action === 'pause' ? 'paused' : 'cancelled');
    const restored = new Downloads(f.dir, () => f.config, {}, {});
    await restored.load();
    await restored.pump();
    assert.equal(restored.jobs[0].status, f.job.status);
    restored.stop();
    assert.equal(f.links(), 0);
  }
});

test('fixed retry budget and redacted diagnostics survive persistence', async (t) => {
  const f = await fixture(t);
  const error = Object.assign(
    Error('fetch failed secret-api-key private-password https://cdn.test/?token=private'),
    { code: 'ECONNRESET' },
  );
  for (let i = 0; i < MAX_RETRIES; i++) {
    f.job.status = 'downloading';
    assert.equal(await f.queue.recover(f.job, error), true);
  }
  f.job.status = 'downloading';
  assert.equal(await f.queue.recover(f.job, error), false);
  assert.equal(f.job.recovery.retryCount, MAX_RETRIES);
  const history = JSON.stringify(f.queue.snapshot());
  for (const secret of ['secret-api-key', 'private-password', 'token=private', 'magnet:'])
    assert.ok(!history.includes(secret));
});

test('credential and disk errors stop; transfer URL expiry remains recoverable', () => {
  assert.equal(classify(Object.assign(Error('Unauthorized'), { status: 401 })).action, 'settings');
  assert.equal(
    classify(Object.assign(Error('Expired'), { transfer: true, status: 403 })).action,
    'refresh',
  );
  assert.equal(classify(Object.assign(Error('Disk full'), { code: 'ENOSPC' })).action, 'attention');
  assert.equal(retryAfter('60', 0), 60000);
  assert.equal(retryAfter('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60000);
  assert.ok(backoff(1, 0, () => 0.5) < backoff(5, 0, () => 0.5));
});

test('startup restores recovery, but interrupted installer requires review', async (t) => {
  const f = await fixture(t);
  f.job.status = 'verifying';
  const manual = { ...f.job, id: randomUUID(), status: 'paused', pauseReason: 'manual' };
  const installing = {
    ...f.job,
    id: randomUUID(),
    status: 'installing',
    recovery: { ...checkpoint(true), installerStarted: true },
  };
  f.queue.jobs.push(manual, installing);
  await f.queue.persist();
  const restored = new Downloads(f.dir, () => f.config, {}, {});
  await restored.load();
  assert.deepEqual(
    restored.jobs.map((job) => job.status),
    ['waiting-retry', 'paused', 'needs-setup'],
  );
  restored.stop();
});

test('verification and extraction resume locally without touching the service after a worker crash', async (t) => {
  const f = await fixture(t, {
    apiFactory: () => assert.fail('Downloaded files must recover offline'),
  });
  const raw = path.join(f.dir, '.mamba-downloads', f.job.id, 'raw');
  await fs.mkdir(raw, { recursive: true });
  await fs.writeFile(path.join(raw, 'game.exe'), 'abcdef');
  f.job.recovery.phase = 'extracting';
  f.job.recovery.files = [{ name: 'game.exe', size: 6 }];
  // An interrupted payload is disposable and never merges into the rebuilt result.
  const payload = path.join(path.dirname(raw), 'payload');
  await fs.mkdir(payload);
  await fs.writeFile(path.join(payload, 'garbage'), 'old');
  await f.queue.pump();
  assert.equal(f.job.status, 'completed', f.job.message);
  await assert.rejects(fs.stat(path.join(f.job.folder, 'garbage')), { code: 'ENOENT' });
});

test('committed and renamed payloads finish registration after a crash without redownloading', async (t) => {
  for (const renamed of [false, true]) {
    const f = await fixture(t, {
      apiFactory: () => ({ create: () => assert.fail('Already committed') }),
    });
    const old = path.join(f.dir, 'Fixture Game-fixtur');
    const folder = renamed ? path.join(f.dir, 'Fixture Game') : old;
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'game.exe'), 'abcdef');
    await atomicJson(path.join(folder, '.mamba-game.json'), {
      name: f.job.name,
      releaseId: f.job.gameId,
      downloadId: f.job.id,
      status: 'installed',
    });
    f.job.folder = old;
    Object.assign(f.job.recovery, {
      payloadCommitted: true,
      phase: 'finalizing',
      ...(renamed ? { renameTarget: folder } : {}),
    });
    await f.queue.pump();
    assert.equal(f.job.status, 'completed', f.job.message);
    assert.equal(f.job.folder, path.join(f.dir, 'Fixture Game'));
  }
});

test('existing destination and symlinked staging never get overwritten', async (t) => {
  for (const linked of [false, true]) {
    const f = await fixture(t);
    if (linked) {
      const outside = path.join(f.dir, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'keep'), 'safe');
      await fs.symlink(outside, path.join(f.dir, '.mamba-downloads'), 'junction');
    } else {
      f.job.folder = path.join(f.dir, 'existing');
      await fs.mkdir(f.job.folder);
      await fs.writeFile(path.join(f.job.folder, 'keep'), 'safe');
    }
    await f.queue.pump();
    assert.equal(f.job.status, 'failed');
    assert.equal(
      await fs.readFile(path.join(f.dir, linked ? 'outside' : 'existing', 'keep'), 'utf8'),
      'safe',
    );
  }
});

test('changed validators preserve bytes until a bounded file-only restart', async (t) => {
  const f = await fixture(t);
  const raw = path.join(f.dir, '.mamba-downloads', f.job.id, 'raw');
  await fs.mkdir(raw, { recursive: true });
  const target = path.join(raw, 'game.exe');
  await fs.writeFile(target + '.part', 'abc');
  const metadata = path.join(
    raw,
    '.mamba-transfer',
    createHash('sha256').update('game.exe').digest('hex') + '.json',
  );
  await atomicJson(metadata, { etag: '"old"' });
  await assert.rejects(
    downloadFile(
      'https://cdn.test',
      target,
      6,
      undefined,
      () => {},
      async () =>
        new Response('def', {
          status: 206,
          headers: { ETag: '"new"', 'Content-Range': 'bytes 3-5/6' },
        }),
    ),
    /changed content/,
  );
  assert.equal(await fs.readFile(target + '.part', 'utf8'), 'abc');
  f.job.activeFile = target;
  const error = Error('Invalid download resume response');
  assert.equal(await f.queue.recover(f.job, error), true);
  await assert.rejects(fs.stat(target + '.part'), { code: 'ENOENT' });
  assert.equal(await f.queue.recover(f.job, error), false);
});

test('checksum mismatch redownloads only the affected file once and never commits persistent corruption', async (t) => {
  const f = await fixture(t, {
    apiFactory: () => ({
      create: async () => ({ kind: 'torrents', id: 1 }),
      info: async () => ({
        download_finished: true,
        files: [{ id: 0, name: 'game.exe', size: 6, sha256: 'f'.repeat(64) }],
      }),
      downloadLink: async () => 'https://cdn.test',
    }),
  });
  await f.queue.pump();
  assert.equal(f.job.status, 'waiting-retry');
  f.advance();
  await f.queue.pump();
  assert.equal(f.job.status, 'failed');
  assert.equal(f.job.recovery.payloadCommitted, false);
  await assert.rejects(fs.stat(f.job.folder), { code: 'ENOENT' });
});

test('size and hashes are checked independently and corrupt archives fail before extraction', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.dir, 'broken.zip');
  await fs.writeFile(file, 'not an archive');
  await assert.rejects(verifyFile(file, { size: 100 }), { code: 'FILE_INVALID' });
  await assert.rejects(verifyFile(file, { sha256: '0'.repeat(64) }), { code: 'FILE_INVALID' });
  await verifyFile(file, { sha256: createHash('sha256').update('not an archive').digest('hex') });
  await assert.rejects(testArchive(file), { code: 'ARCHIVE_INVALID' });
});

test('supported installer completion checkpoint prevents running setup twice', async (t) => {
  const f = await fixture(t);
  f.config.autoInstall = true;
  const folder = path.join(f.dir, 'Fixture Game');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'game.exe'), 'game');
  await fs.writeFile(
    path.join(folder, 'setup.exe'),
    'Inno Setup - must never execute this fixture',
  );
  await atomicJson(path.join(folder, '.mamba-game.json'), {
    downloadId: f.job.id,
    releaseId: f.job.gameId,
  });
  f.job.folder = folder;
  Object.assign(f.job.recovery, { installerFinished: true, payloadCommitted: true });
  await f.queue.pump();
  assert.equal(f.job.status, 'completed', f.job.message);
});

test('wrapper cleanup finishes an interrupted transaction without losing content', async (t) => {
  const f = await fixture(t);
  const root = path.join(f.dir, 'flatten');
  await fs.mkdir(root);
  const holding = path.join(root, '.mamba-wrapper-' + randomUUID());
  await fs.mkdir(holding);
  await fs.writeFile(path.join(root, 'game.exe'), 'already moved');
  await fs.writeFile(path.join(holding, 'data.bin'), 'remaining');
  await atomicJson(path.join(root, '.mamba-flatten.json'), {
    nested: path.join(root, 'Wrapper'),
    holding,
    children: ['game.exe', 'data.bin'],
  });
  await flatten(root);
  assert.equal(await fs.readFile(path.join(root, 'data.bin'), 'utf8'), 'remaining');
  await assert.rejects(fs.stat(holding), { code: 'ENOENT' });
});

test('only identical torrent identity can supply automatic fallback candidates', async (t) => {
  const f = await fixture(t);
  f.config.enabledDownloadServices = ['torbox', 'realdebrid'];
  const catalog = new Catalog(f.dir, () => f.config);
  catalog.byId = new Map([
    ['same', { links: [{ uri: f.job.uri, services: ['torbox', 'realdebrid'] }] }],
    [
      'different',
      { links: [{ uri: 'magnet:?xt=urn:btih:' + 'b'.repeat(40), services: ['realdebrid'] }] },
    ],
  ]);
  catalog.getGame = () => ({ id: 'fixture' });
  catalog.resolveGame = async () => ({
    options: [
      { gameId: 'same', linkIndex: 0, available: true, services: ['torbox', 'realdebrid'] },
      { gameId: 'different', linkIndex: 0, available: true, services: ['realdebrid'] },
    ],
  });
  assert.deepEqual(await catalog.recoveryCandidates(f.job, f.config), [
    { uri: f.job.uri, service: 'realdebrid' },
  ]);
  f.job.uri = 'https://host.test/game.zip';
  assert.deepEqual(await catalog.recoveryCandidates(f.job, f.config), []);
});

test('identical-service fallback resumes the existing partial through Real-Debrid', async (t) => {
  let transferRequests = 0;
  const f = await fixture(t, {
    transport: async (url, options) => {
      url = String(url);
      if (url.endsWith('/torrents/addMagnet')) return Response.json({ id: 'new-transfer' });
      if (url.includes('/torrents/info/'))
        return Response.json({
          status: 'downloaded',
          progress: 100,
          files: [{ id: 1, selected: 1, path: '/game.exe', bytes: 6 }],
          links: ['https://host.test/file'],
        });
      if (url.endsWith('/unrestrict/link'))
        return Response.json({ download: 'https://cdn.test/replacement' });
      if (++transferRequests === 1) return new Response('', { status: 403 });
      assert.equal(options.headers.Range, 'bytes=3-');
      return new Response('def', {
        status: 206,
        headers: { 'Content-Range': 'bytes 3-5/6', ETag: '"original"' },
      });
    },
  });
  f.config.enabledDownloadServices = ['torbox', 'realdebrid'];
  f.queue.catalog.recoveryCandidates = async () => [{ uri: f.job.uri, service: 'realdebrid' }];
  f.job.recovery.retryCount = MAX_RETRIES;
  const raw = path.join(f.dir, '.mamba-downloads', f.job.id, 'raw');
  await fs.mkdir(raw, { recursive: true });
  await fs.writeFile(path.join(raw, 'game.exe.part'), 'abc');
  await f.queue.pump();
  assert.equal(f.job.service, 'realdebrid');
  assert.equal(f.job.status, 'waiting-retry');
  f.advance();
  await f.queue.pump();
  assert.equal(f.job.status, 'completed', f.job.message);
  assert.equal(await fs.readFile(path.join(f.job.folder, 'game.exe'), 'utf8'), 'abcdef');
});

test('a symlinked partial cannot redirect writes outside staging', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.dir, 'keep');
  await fs.writeFile(outside, 'safe');
  const target = path.join(f.dir, 'game.exe');
  await fs.symlink(outside, target + '.part');
  await assert.rejects(
    downloadFile(
      'https://cdn.test',
      target,
      6,
      undefined,
      () => {},
      () => assert.fail('Unsafe partial must be rejected before requesting data'),
    ),
    /linked/,
  );
  assert.equal(await fs.readFile(outside, 'utf8'), 'safe');
});

test('disabling recovery pauses waiting jobs and never starts another request', async (t) => {
  const f = await fixture(t);
  await f.queue.recover(f.job, Object.assign(Error('Connection reset'), { code: 'ECONNRESET' }));
  f.config.automaticRecovery = false;
  f.advance();
  await f.queue.pump();
  assert.equal(f.job.status, 'paused');
  assert.equal(f.links(), 0);
});
