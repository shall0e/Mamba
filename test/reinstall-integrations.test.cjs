const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { BackgroundService } = require('../src/core/background-service.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-reintegrate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'Game');
  await fs.mkdir(folder);
  const game = { id: 'installed-game', folder, status: 'installed' };
  const service = new BackgroundService(() => {});
  service.config = { downloadPath: root };
  service.libraryState = { data: { imports: [] } };
  service.library = { get: (id) => (id === game.id ? game : null) };
  service.downloads = { jobs: [], controllers: new Map() };
  return { root, folder, game, service };
}

test('manual integration reinstall bypasses the first-install marker and targets only the selected installation', async (t) => {
  const { folder, game, service } = await fixture(t);
  const marker = JSON.stringify({ installExtrasAttempted: true });
  await fs.writeFile(path.join(folder, '.mamba-game.json'), marker);
  const targets = [];
  service.installMetadata = { apply: async (target) => targets.push(target) };
  assert.equal(await service.call('library:reinstall-integrations', [game.id]), true);
  assert.equal(await service.call('library:reinstall-integrations', [game.id]), true);
  assert.deepEqual(targets, [folder, folder]);
  assert.equal(await fs.readFile(path.join(folder, '.mamba-game.json'), 'utf8'), marker);
});

test('reinstall rejects missing games, unavailable installations, unauthorized folders, and active downloads', async (t) => {
  const { root, folder, game, service } = await fixture(t);
  service.installMetadata = { apply: async () => assert.fail('must not extract') };
  await assert.rejects(service.reinstallIntegrations('unknown'), /Locate or install/);
  for (const status of ['not-installed', 'drive-unavailable']) {
    game.status = status;
    await assert.rejects(service.reinstallIntegrations(game.id), /Locate or install/);
  }
  game.status = 'installed';
  service.config.downloadPath = path.join(root, 'another-root');
  await assert.rejects(service.reinstallIntegrations(game.id), /escapes/);
  service.config.downloadPath = root;
  service.downloads.jobs = [{ id: 'active', folder }];
  service.downloads.controllers.set('active', {});
  await assert.rejects(service.reinstallIntegrations(game.id), /Wait for this download/);
});

test('overlapping manual reinstalls share one extraction and clear the lock after failure', async (t) => {
  const { game, service } = await fixture(t);
  let finish,
    calls = 0;
  const started = new Promise((resolve) => {
    service.installMetadata = {
      apply: () => {
        calls++;
        resolve();
        return new Promise((_, reject) => {
          finish = reject;
        });
      },
    };
  });
  const first = service.reinstallIntegrations(game.id);
  await started;
  const second = service.reinstallIntegrations(game.id);
  assert.equal(service.installationBusy(game), true);
  finish(Error('archive unavailable'));
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(calls, 1);
  assert.equal(service.integrationRepairs.size, 0);
  service.installMetadata.apply = async () => {
    calls++;
  };
  assert.equal(await service.reinstallIntegrations(game.id), true);
  assert.equal(calls, 2);
});
