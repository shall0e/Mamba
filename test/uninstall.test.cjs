const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { xboxManaged, removeUnmanagedInstallation } = require('../src/core/uninstall.cjs');
test('Xbox-managed installations are detected before any files can be deleted', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-uninstall-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.mkdir(path.join(folder, 'Content'));
  await fs.writeFile(path.join(folder, 'Content', 'MicrosoftGame.config'), '<Game/>');
  await fs.writeFile(path.join(folder, 'protected-file'), 'preserved');
  assert.equal(await xboxManaged(folder), true);
  await assert.rejects(removeUnmanagedInstallation(folder), /Xbox app/);
  assert.equal(await fs.readFile(path.join(folder, 'protected-file'), 'utf8'), 'preserved');
});
test('ordinary installations can still be removed', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-uninstall-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  assert.equal(await xboxManaged(folder), false);
  await fs.writeFile(path.join(folder, 'game.exe'), 'fixture');
  await removeUnmanagedInstallation(folder);
  assert.equal(await fs.stat(folder).catch(() => null), null);
});
test('permission failures explain the launcher route without reporting success', async (t) => {
  t.mock.method(fs, 'rm', async () => {
    throw Object.assign(Error('denied'), { code: 'EPERM' });
  });
  await assert.rejects(
    removeUnmanagedInstallation(path.join(os.tmpdir(), 'mamba-no-installation-here')),
    /Some files may already have been removed/,
  );
});
