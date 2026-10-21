const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { registerXbox, mergeXboxLibrary } = require('../src/core/xbox.cjs');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-xbox-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'start.cmd');
  await fs.writeFile(executable, 'fixture');
  return { directory, game: { name: 'Fixture Game', executable, folder: directory } };
}
test('Xbox registration preserves custom entries and deduplicates batch launchers', async (t) => {
  const { directory, game } = await fixture(t),
    file = path.join(directory, 'CustomLibraryManagement.manifest');
  const original = {
    other: {
      id: 'other',
      title: 'Other',
      addedDate: '1',
      installLocation: 'C:\\Other\\',
      executableName: 'other.exe',
      executableCommandArgs: '',
      customField: true,
    },
  };
  await fs.writeFile(file, JSON.stringify(original));
  assert.equal((await registerXbox(game, { directory })).status, 'added');
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(saved.other, original.other);
  const entry = Object.values(saved).find((e) => e.title === game.name);
  assert.match(entry.executableName, /cmd.exe$/i);
  assert.ok(entry.executableCommandArgs.includes(game.executable));
  assert.equal(Object.keys(saved).length, 2);
  const before = await fs.readFile(file, 'utf8');
  await registerXbox(game, { directory });
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.ok((await fs.readdir(directory)).some((name) => name.includes('mamba-backup')));
});
test('Xbox empty manifest initializes and malformed manifests are preserved', async (t) => {
  const { directory, game } = await fixture(t),
    file = path.join(directory, 'CustomLibraryManagement.manifest');
  await fs.writeFile(file, '');
  await registerXbox(game, { directory });
  assert.equal(Object.keys(JSON.parse(await fs.readFile(file, 'utf8'))).length, 1);
  await fs.writeFile(file, '{"unexpected":42}');
  await assert.rejects(registerXbox(game, { directory }), /format changed/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"unexpected":42}');
  assert.equal(
    (await registerXbox(game, { directory: path.join(directory, 'absent') })).status,
    'unavailable',
  );
});
test('Xbox registration maps native executables and preserves titles', () => {
  const game = { name: 'Game Name', executable: 'C:\\Games\\Game Name\\game.exe' };
  const entries = mergeXboxLibrary({}, game);
  const entry = Object.values(entries)[0];
  assert.equal(entry.executableName, 'game.exe');
  assert.equal(entry.installLocation, 'C:\\Games\\Game Name\\');
  assert.equal(entry.title, game.name);
  assert.equal(entry.executableCommandArgs, '');
});
