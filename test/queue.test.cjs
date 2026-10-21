const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Downloads, downloadFile } = require('../src/core/downloads.cjs');
test('speed reports bytes per second without counting resumed bytes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-speed-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'game.bin');
  await fs.writeFile(file + '.part', Buffer.alloc(100));
  let positive = false;
  const transport = async () =>
    new Response(
      new ReadableStream({
        async start(controller) {
          await new Promise((r) => setTimeout(r, 350));
          controller.enqueue(new Uint8Array(100));
          controller.close();
        },
      }),
      { status: 206, headers: { 'content-range': 'bytes 100-199/200', 'content-length': '100' } },
    );
  await downloadFile(
    'https://example.test',
    file,
    200,
    new AbortController().signal,
    (_received, _total, speed) => {
      if (speed > 0) {
        positive = true;
        assert.ok(speed < 500);
      }
    },
    transport,
  );
  assert.equal(positive, true);
});
test('removing active item aborts it and late updates cannot restore it; clearing keeps active jobs', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-queue-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const downloads = new Downloads(dir, () => ({}), {}, {});
  const active = { id: 'active', status: 'downloading' },
    queued = { id: 'queued', status: 'queued' };
  downloads.jobs = [
    active,
    queued,
    { id: 'done', status: 'completed' },
    { id: 'failed', status: 'failed' },
  ];
  const controller = new AbortController();
  downloads.controllers.set('active', controller);
  await downloads.remove('active');
  assert.equal(controller.signal.aborted, true);
  await downloads.update(active, { status: 'failed' });
  assert.equal(downloads.jobs.includes(active), false);
  await downloads.clearFinished();
  assert.deepEqual(downloads.jobs, [queued]);
  assert.deepEqual(JSON.parse(await fs.readFile(downloads.file, 'utf8')), [queued]);
});
const { RollingSpeed } = require('../src/core/downloads.cjs');
test('speed uses a rolling 20 seconds, warms up and decays to zero when stalled', () => {
  let now = 0;
  const meter = new RollingSpeed(() => now);
  assert.equal(meter.add(), 0);
  for (let i = 1; i <= 20; i++) {
    now = i * 1000;
    assert.equal(meter.add(1000000), 1000000);
  }
  for (let i = 21; i <= 40; i++) {
    now = i * 1000;
    meter.add(3000000);
  }
  assert.equal(meter.add(), 3000000);
  now = 50000;
  assert.equal(meter.add(), 1500000);
  now = 60000;
  assert.equal(meter.add(), 0);
});
test('ETA uses averaged speed and handles unknown speed', () => {
  const vm = require('node:vm');
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/renderer/scripts/app.js'),
    'utf8',
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('function remainingTime('),
      source.indexOf('function renderCatalog('),
    ),
    context,
  );
  assert.equal(
    context.remainingTime({ speed: 1000000, total: 121000000, received: 1000000 }),
    '2m remaining',
  );
  assert.equal(context.remainingTime({ speed: 0, total: 100, received: 0 }), 'Estimating time…');
  assert.equal(
    context.remainingTime({ speed: 100, total: 100, received: 100 }),
    'Finishing download…',
  );
});
