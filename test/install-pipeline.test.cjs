const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Downloads } = require('../src/core/downloads.cjs');
const {
  safeName,
  installerCommand,
  run,
  sevenZipPath,
  extractArchive,
} = require('../src/core/library.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-install-pipeline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('downloads remain serial while extraction and installation overlap, including newly queued jobs', async (t) => {
  const queue = new Downloads(await directory(t), async () => ({}), {}, {});
  const gates = new Map(
    ['a', 'b', 'c'].map((id) => [
      id,
      {
        started: deferred(),
        downloaded: deferred(),
        processing: deferred(),
        finished: deferred(),
      },
    ]),
  );
  queue.jobs = ['a', 'b'].map((id) => ({ id, status: 'queued' }));
  let transfers = 0,
    peakTransfers = 0,
    processing = 0,
    peakProcessing = 0;
  queue.execute = async (job, _signal, release) => {
    const gate = gates.get(job.id);
    transfers++;
    peakTransfers = Math.max(peakTransfers, transfers);
    job.status = 'downloading';
    gate.started.resolve();
    await gate.downloaded.promise;
    transfers--;
    job.status = job.id === 'a' ? 'extracting' : 'installing';
    processing++;
    peakProcessing = Math.max(peakProcessing, processing);
    release();
    gate.processing.resolve();
    await gate.finished.promise;
    processing--;
    job.status = 'completed';
  };
  const first = queue.pump();
  await gates.get('a').started.promise;
  assert.equal(queue.jobs[1].status, 'queued');
  gates.get('a').downloaded.resolve();
  await gates.get('b').started.promise;
  assert.equal(queue.jobs[0].status, 'extracting');
  gates.get('b').downloaded.resolve();
  await gates.get('b').processing.promise;
  await new Promise((resolve) => setImmediate(resolve));
  queue.jobs.push({ id: 'c', status: 'queued' });
  const second = queue.pump();
  await gates.get('c').started.promise;
  gates.get('c').downloaded.resolve();
  await gates.get('c').processing.promise;
  for (const gate of gates.values()) gate.finished.resolve();
  await Promise.all([first, second]);
  assert.equal(peakTransfers, 1);
  assert.equal(peakProcessing, 3);
  assert.ok(queue.jobs.every((job) => job.status === 'completed'));
  assert.equal(queue.controllers.size, 0);
  queue.stop();
});

test('folder names are readable, valid on Windows and trimmed after length limiting', () => {
  assert.equal(safeName('  Left  4 Dead 2: Complete?  '), 'Left 4 Dead 2 Complete');
  assert.equal(safeName('CON.txt'), 'Game_CON.txt');
  assert.equal(safeName('../Game\\bad*name...'), '.. Game bad name');
  assert.equal(safeName('x'.repeat(109) + ' .tail').endsWith(' '), false);
  assert.equal(safeName('...'), 'Game_');
});

test('known installers receive framework-specific silent switches and unknown installers require review', async (t) => {
  const root = await directory(t);
  const target = path.join(root, 'Game with spaces');
  const setup = path.join(root, 'setup.exe');
  await fs.writeFile(setup, 'Inno Setup Setup Data');
  let plan = await installerCommand(setup, target);
  assert.ok(plan.args.includes('/VERYSILENT'));
  assert.ok(plan.args.includes('/NORESTART'));
  assert.ok(plan.args.includes('/DIR=' + target));
  await fs.writeFile(setup, 'NullsoftInst');
  plan = await installerCommand(setup, target);
  assert.deepEqual(plan.args, ['/S', '/D=' + target]);
  assert.equal(plan.windowsVerbatimArguments, true);
  plan = await installerCommand(path.join(root, 'setup.msi'), target);
  assert.ok(plan.args.includes('/qn'));
  assert.ok(plan.args.includes('INSTALLDIR=' + target));
  await fs.writeFile(setup, 'Unknown custom installer');
  assert.equal(await installerCommand(setup, target), null);
});

test('archive extraction reports actual 7-Zip progress and produces the payload', async (t) => {
  const root = await directory(t);
  const input = path.join(root, 'input.bin');
  const archive = path.join(root, 'game.zip');
  const output = path.join(root, 'output');
  await fs.writeFile(input, Buffer.alloc(1024 * 1024, 7));
  await run(sevenZipPath(), ['a', '-tzip', archive, input]);
  const progress = [];
  await extractArchive(archive, output, {
    verifiedArchives: new Set([archive]),
    onProgress: (value) => progress.push(value),
  });
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((value) => value >= 0 && value <= 100));
  assert.equal((await fs.stat(path.join(output, 'input.bin'))).size, 1024 * 1024);
});

test('administrator setup reuses files and resumes finalization, while cancellation keeps setup recoverable', async (t) => {
  const queue = new Downloads(await directory(t), async () => ({}), {}, {});
  let resumed = 0;
  queue.pump = async () => {
    resumed++;
  };
  const job = { id: 'setup', status: 'needs-setup', folder: 'saved-game', recovery: {} };
  queue.jobs = [job];
  await queue.setupState(job.id, 'running');
  assert.equal(job.status, 'installing');
  assert.equal(job.progress, null);
  await queue.setupState(job.id, 'failed');
  assert.equal(job.status, 'needs-setup');
  assert.equal(job.folder, 'saved-game');
  await queue.setupState(job.id, 'running');
  await queue.setupState(job.id, 'finished');
  assert.equal(job.status, 'queued');
  assert.equal(job.recovery.installerStarted, false);
  assert.equal(job.recovery.installerFinished, true);
  assert.equal(resumed, 1);
});
