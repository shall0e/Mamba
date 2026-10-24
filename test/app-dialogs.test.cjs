const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAppDialogs } = require('../src/main/app-dialogs.cjs');
const { uninstallAsAdministrator } = require('../src/main/uninstall-admin.cjs');
test('app dialogs accept only a valid response from their own window and cancel on navigation', async () => {
  let reply, payload;
  const ipc = {
    handle: (_name, callback) => {
      reply = callback;
    },
  };
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  sender.send = (_name, data) => {
    payload = data;
  };
  const show = createAppDialogs(ipc);
  const pending = show({ webContents: sender }, { buttons: ['Keep', 'Remove'], cancelId: 0 });
  assert.equal(reply({ sender: {} }, payload.id, 1), false);
  assert.equal(reply({ sender }, payload.id, 10), false);
  assert.equal(reply({ sender }, payload.id, 1), true);
  assert.deepEqual(await pending, { response: 1 });
  const cancelled = show({ webContents: sender }, { buttons: ['Keep', 'Remove'], cancelId: 0 });
  sender.emit('did-start-navigation');
  assert.deepEqual(await cancelled, { response: 0 });
});
test('administrator retry can be cancelled and only reports success after removal', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-admin-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const cancelled = await uninstallAsAdministrator(folder, {
    run: async () => ({ stdout: '1223' }),
  });
  assert.equal(cancelled, false);
  assert.ok(await fs.stat(folder));
  await assert.rejects(
    uninstallAsAdministrator(folder, { run: async () => ({ stdout: '0' }) }),
    /files remain/,
  );
  await assert.rejects(
    uninstallAsAdministrator(path.parse(folder).root, {
      run: async () => {
        throw Error('must not run');
      },
    }),
    /path changed/,
  );
});
