const test = require('node:test'),
  assert = require('node:assert/strict');
const { validateSettings, encodeConfig, decodeConfig } = require('../src/core/config-transfer.cjs');
const { Updates } = require('../src/core/updates.cjs');
const { EventEmitter } = require('node:events');

test('shared setup exports only connection and advanced settings', () => {
  const { encodeSetupConfig } = require('../src/core/config-transfer.cjs');
  const shared = {
    torboxApiKey: 'shared-key',
    realDebridApiKey: 'other-key',
    archivePassword: 'archive',
    sourceUrls: ['https://example.test/feed.json'],
    disabledSourceUrls: ['https://example.test/disabled.json'],
    enabledDownloadServices: ['direct'],
    preferredDownloadService: 'direct',
    disabledDownloadHosts: ['example.test'],
    autoInstall: false,
    automaticRecovery: true,
    cachedOnly: false,
    keepArchives: true,
    transferTimeoutMinutes: 45,
    preferredLanguage: 'english',
    preferredRelease: 'portable',
    automaticUpdates: true,
  };
  const personal = {
    appearance: { customFont: 'private' },
    palette: { primary: '#123456' },
    downloadPath: 'C:\\Private',
    extraGameFolders: ['D:\\Games'],
    libraryState: { games: { private: { favorite: true } } },
    librarySort: 'recent',
    libraryView: 'list',
    steamAccount: 'private-user',
    onboardingCompleted: true,
    unknownFuturePersonalSetting: 'private',
  };
  assert.deepEqual(decodeConfig(encodeSetupConfig({ ...shared, ...personal }, '1.5.0')), shared);
  assert.deepEqual(decodeConfig(encodeSetupConfig({}, '1.5.0')), {});
});
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

test('latest release selection uses build identity rather than version ordering', async () => {
  const updater = new EventEmitter();
  let feed;
  updater.setFeedURL = (value) => {
    feed = value;
  };
  updater.isUpdateAvailable = async () => false;
  updater.isUpdateSupported = async (info) => info.supported !== false;
  updater.isUserWithinRollout = async (info) => info.rollout !== false;
  new Updates(updater, {
    version: '1.4.6',
    buildHash: 'a'.repeat(64),
    packaged: true,
    getConfig: async () => ({}),
  });
  assert.equal(feed.url, 'https://github.com/shall0e/Mamba/releases/latest/download/');
  const info = {
    version: '1.4.5-hotfix',
    mambaBuildHash: 'b'.repeat(64),
    files: [{ url: 'Mamba.exe', sha512: Buffer.alloc(64, 1).toString('base64') }],
  };
  assert.equal(await updater.isUpdateAvailable(info), true);
  assert.equal(await updater.isUpdateAvailable({ ...info, version: '1.4.6' }), true);
  assert.equal(await updater.isUpdateAvailable({ ...info, mambaBuildHash: 'a'.repeat(64) }), false);
  assert.equal(await updater.isUpdateAvailable({ ...info, supported: false }), false);
  assert.equal(await updater.isUpdateAvailable({ ...info, rollout: false }), false);
  assert.equal(await updater.isUpdateAvailable({ version: '1.4.5' }), false);
  await assert.rejects(
    updater.isUpdateAvailable({ ...info, files: [{ sha512: 'bad' }] }),
    /SHA-512/,
  );
});
