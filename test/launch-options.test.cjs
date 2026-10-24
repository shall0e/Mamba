const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {
  normalizeLaunchOptions,
  parseArguments,
  launchConfiguration,
} = require('../src/core/launch-options.cjs');
const { addShortcut, parseVdf, launchTarget } = require('../src/core/shortcuts.cjs');
const { Library } = require('../src/core/library.cjs');
test('arguments preserve quoted values, empty arguments, and Windows backslashes', () => {
  assert.deepEqual(parseArguments('-windowed --name "Two words" "" C:\\Games\\Demo'), [
    '-windowed',
    '--name',
    'Two words',
    '',
    'C:\\Games\\Demo',
  ]);
  assert.deepEqual(parseArguments('--name "say \\"hello\\""'), ['--name', 'say "hello"']);
  assert.throws(() => parseArguments('"unfinished'), /quotation/);
  assert.throws(() => normalizeLaunchOptions({ arguments: 'a\nb' }), /single line/);
});
test('Steam options update one existing shortcut and retain its identity', () => {
  const folder = path.resolve('fixture');
  const game = { name: 'Example', folder, executable: path.join(folder, 'bin', 'game.exe') };
  const original = addShortcut(Buffer.alloc(0), game);
  const changed = {
    ...game,
    launchOptions: { arguments: '-windowed --name "Two words"', workingDirectory: '.' },
  };
  const updated = addShortcut(original, changed);
  const entries = parseVdf(updated)[0].value;
  assert.equal(entries.length, 1);
  const fields = Object.fromEntries(entries[0].value.map((field) => [field.key, field.value]));
  assert.equal(fields.LaunchOptions, changed.launchOptions.arguments);
  assert.equal(fields.StartDir, '"' + folder + '"');
  assert.ok(addShortcut(updated, changed).equals(updated));
  assert.ok(
    fields.appid.equals(
      parseVdf(original)[0].value[0].value.find((field) => field.key === 'appid').value,
    ),
  );
  assert.deepEqual(launchConfiguration(changed).argv, ['-windowed', '--name', 'Two words']);
  assert.throws(
    () => launchConfiguration({ ...game, launchOptions: { workingDirectory: '..' } }),
    /escapes/,
  );
  assert.match(launchTarget(path.join(folder, 'start.cmd'), '--example').args, /--example/);
});
test('saved launch options survive library reload', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-launch-options-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const folder = path.join(dir, 'Example');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'game.exe'), 'fixture');
  const launchOptions = { arguments: '-windowed', workingDirectory: '.' };
  await fs.writeFile(
    path.join(folder, '.mamba-game.json'),
    JSON.stringify({ name: 'Example', executable: 'game.exe', status: 'installed' }),
  );
  const library = new Library(async () => ({ automaticGameDetection: false, downloadPath: dir }));
  await library.scan();
  const { BackgroundService } = require('../src/core/background-service.cjs');
  const service = new BackgroundService(() => {});
  service.config = { automaticGameDetection: false, downloadPath: dir };
  service.libraryState = { data: { imports: [] } };
  service.downloads = { jobs: [], controllers: new Map() };
  service.library = library;
  const id = library.items[0].id;
  await service.call('library:launch-options', [id, launchOptions]);
  const reloaded = new Library(async () => ({ automaticGameDetection: false, downloadPath: dir }));
  await reloaded.scan();
  assert.deepEqual(reloaded.items[0].launchOptions, launchOptions);
  await assert.rejects(
    service.call('library:launch-options', [id, { workingDirectory: '..' }]),
    /escapes/,
  );
});
