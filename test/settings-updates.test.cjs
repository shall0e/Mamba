const test = require('node:test'),
  assert = require('node:assert/strict');
const { validateSettings, encodeConfig, decodeConfig } = require('../src/core/config-transfer.cjs');
const { Updates } = require('../src/core/updates.cjs');
const { EventEmitter } = require('node:events');
test('complete config round trip preserves credentials, advanced settings and unknown future settings', () => {
  const settings = {
    torboxApiKey: 'fixture-key',
    archivePassword: 'fixture-password',
    automaticGameDetection: false,
    downloadPath: 'C:\\Games',
    sourceUrls: ['https://example.test/feed.json'],
    autoInstall: true,
    automaticRecovery: true,
    cachedOnly: false,
    keepArchives: true,
    transferTimeoutMinutes: 42,
    automaticUpdates: false,
    palette: { primary: '#123456' },
    futureSetting: { enabled: true },
  };
  assert.deepEqual(decodeConfig(encodeConfig(settings, '0.2.0')), settings);
  assert.deepEqual(decodeConfig(JSON.stringify(settings)), settings);
  assert.throws(() => decodeConfig('{"__proto__":{}}'), /Invalid settings key/);
  assert.throws(() => decodeConfig('{"schemaVersion":2,"settings":{}}'), /unsupported/);
  assert.throws(() => validateSettings({ sourceUrls: ['file:///bad'] }));
  assert.throws(() => validateSettings({ transferTimeoutMinutes: 0 }));
  assert.throws(() => validateSettings({ automaticRecovery: 'yes' }));
  assert.throws(() => validateSettings({ palette: { primary: 'red' } }));
});
test('updater honors preferences, exposes progress and blocks restart during transfers', async () => {
  const updater = new EventEmitter();
  let checks = 0,
    installed = false,
    canInstall = false;
  updater.checkForUpdates = async () => {
    checks++;
  };
  updater.quitAndInstall = () => {
    installed = true;
  };
  const updates = new Updates(updater, {
    version: '0.2.0',
    packaged: true,
    getConfig: async () => ({ automaticUpdates: false }),
    canInstall: () => canInstall,
  });
  await updates.check();
  assert.equal(checks, 0);
  await updates.check(true);
  assert.equal(checks, 1);
  updater.emit('update-available', { version: '0.3.0' });
  updater.emit('download-progress', { percent: 52.2 });
  assert.equal(updates.state.percent, 52);
  updater.emit('update-downloaded', { version: '0.3.0' });
  assert.equal(updates.state.status, 'ready');
  assert.throws(() => updates.install(), /Finish or cancel/);
  canInstall = true;
  updates.install();
  assert.equal(installed, true);
  updates.stop();
});
test('development builds do not attempt updates and errors are readable', async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = () => assert.fail('development update');
  const updates = new Updates(updater, {
    version: '0.2.0',
    packaged: false,
    getConfig: async () => ({}),
  });
  await updates.check(true);
  assert.equal(updates.state.status, 'development');
  updater.emit('error', new Error('404 latest.yml'));
  assert.match(updates.state.message, /No update release/);
});
