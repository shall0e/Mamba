const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { addShortcut, parseVdf, steamLaunchUrl } = require('../src/core/shortcuts.cjs');
test('Steam launch registers missing shortcuts once and uses the saved shortcut ID', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-steam-launch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'shortcuts.vdf');
  const game = { name: 'Example', folder: dir, executable: path.join(dir, 'game.exe') };
  let registrations = 0;
  const options = {
    profile: async () => file,
    setup: async () => {
      registrations++;
      await fs.writeFile(file, addShortcut(Buffer.alloc(0), game));
      return { steam: { status: 'added' } };
    },
  };
  const url = await steamLaunchUrl(game, options);
  const entry = parseVdf(await fs.readFile(file))[0].value[0];
  const appid = entry.value.find((field) => field.key === 'appid').value;
  assert.equal(url, 'steam://rungameid/' + ((BigInt(appid.readUInt32LE(0)) << 32n) | 0x02000000n));
  assert.equal(await steamLaunchUrl(game, options), url);
  assert.equal(registrations, 1);
  assert.equal(
    await steamLaunchUrl(game, {
      profile: async () => {
        throw Error('Steam installation was not found.');
      },
      setup: options.setup,
    }),
    null,
  );
  assert.equal(registrations, 1);
});

test('Steam launch follows a launcher moved by Add Game folder cleanup', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-steam-move-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'shortcuts.vdf');
  const game = { name: 'Example', folder: dir, executable: path.join(dir, 'old', 'game.exe') };
  const moved = { ...game, executable: path.join(dir, 'new', 'game.exe') };
  const url = await steamLaunchUrl(game, {
    profile: async () => file,
    setup: async () => {
      await fs.writeFile(file, addShortcut(Buffer.alloc(0), moved));
      return { ...moved, steam: { status: 'added' } };
    },
  });
  assert.match(url, /^steam:\/\/rungameid\/\d+$/);
});

test('native Steam games launch without shortcut registration or local profile discovery', async () => {
  const url = await steamLaunchUrl(
    { steamLibrary: true, steamId: 550 },
    {
      profile: async () => {
        throw Error('should not inspect local shortcuts');
      },
      setup: async () => {
        throw Error('should not register a shortcut');
      },
    },
  );
  assert.equal(url, 'steam://run/550');
});
test('non-Steam games can launch directly when the local Steam session is unavailable', async () => {
  const url = await steamLaunchUrl(
    {},
    {
      profile: async () => {
        throw Error('Sign into Steam once so Mamba can identify your library.');
      },
    },
  );
  assert.equal(url, null);
});
