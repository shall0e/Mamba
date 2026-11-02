const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../src/main/config-store.cjs');
const { validateSettings } = require('../src/core/config-transfer.cjs');

test('labeled navigation is the legacy default and explicit collapse survives a store restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-desktop-pref-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, 'config.json'),
    JSON.stringify({ sourceUrls: [], extraGameFolders: [], downloadPath: root }),
  );
  const open = () =>
    createConfigStore({
      app: { getPath: () => root },
      dataDirectory: () => root,
      onChange: async () => {},
      getInstalledGames: () => [],
      reportIssue: () => {},
    });
  const first = open();
  assert.equal(first.publicConfig(await first.readConfig()).sidebarCollapsed, false);
  await first.updateConfig((c) => {
    c.sidebarCollapsed = true;
  });
  const restarted = open();
  assert.equal(restarted.publicConfig(await restarted.readConfig()).sidebarCollapsed, true);
  await restarted.updateConfig((c) => {
    c.sidebarCollapsed = false;
  });
  assert.equal(open().publicConfig(await open().readConfig()).sidebarCollapsed, false);
});

test('configuration transfer preserves boolean sidebar preferences and rejects invalid types', () => {
  for (const sidebarCollapsed of [true, false])
    assert.equal(validateSettings({ sidebarCollapsed }).sidebarCollapsed, sidebarCollapsed);
  for (const sidebarCollapsed of ['true', 1, null])
    assert.throws(() => validateSettings({ sidebarCollapsed }));
});
