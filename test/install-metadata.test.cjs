const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { InstallMetadata } = require('../src/core/install-metadata.cjs');

test('metadata extracts arbitrary nested and binary files into every installation and overwrites existing files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-install-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'nested'), { recursive: true });
  const bytes = Buffer.from([0, 255, 42]);
  await fs.writeFile(path.join(source, 'nested', 'extra.bin'), bytes);
  const archive = path.join(root, 'package.zip');
  execFileSync(path.resolve('vendor/7zip/7z.exe'), ['a', archive, '.'], { cwd: source });
  const archiveBytes = await fs.readFile(archive);
  let requests = 0;
  const metadata = new InstallMetadata(root, async (url) => {
    requests++;
    assert.equal(url, 'https://raw.githubusercontent.com/shall0e/Mamba/main/metadata.zip');
    return { ok: true, arrayBuffer: async () => archiveBytes };
  });
  for (const name of ['first', 'second']) {
    const folder = path.join(root, name);
    await fs.mkdir(folder);
    await metadata.apply(folder);
    const target = path.join(folder, 'nested', 'extra.bin');
    assert.deepEqual(await fs.readFile(target), bytes);
    await fs.writeFile(target, 'changed');
    await metadata.apply(folder);
    assert.deepEqual(await fs.readFile(target), bytes);
  }
  assert.equal(requests, 1);
});

test('metadata backs up Steam DLLs and extracts beside them, preserving original backups on retry', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-steam-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  for (const name of ['steam_api.dll', 'steam_api64.dll'])
    await fs.writeFile(path.join(source, name), 'replacement');
  const archive = path.join(root, 'package.zip');
  execFileSync(path.resolve('vendor/7zip/7z.exe'), ['a', archive, '.'], { cwd: source });
  const bytes = await fs.readFile(archive);
  const metadata = new InstallMetadata(root, async () => ({
    ok: true,
    arrayBuffer: async () => bytes,
  }));
  const game = path.join(root, 'game');
  const directories = [path.join(game, 'bin'), path.join(game, 'nested', 'bin64')];
  for (const directory of directories) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directories[0], 'steam_api.dll'), 'original32');
  await fs.writeFile(path.join(directories[0], 'steam_api64.dll'), 'original64');
  await fs.writeFile(path.join(directories[1], 'steam_api64.dll'), 'other64');
  for (let attempt = 0; attempt < 2; attempt++) {
    await metadata.apply(game);
    assert.equal(
      await fs.readFile(path.join(directories[0], 'steam_api_o.dll'), 'utf8'),
      'original32',
    );
    assert.equal(
      await fs.readFile(path.join(directories[0], 'steam_api64_o.dll'), 'utf8'),
      'original64',
    );
    assert.equal(
      await fs.readFile(path.join(directories[1], 'steam_api64_o.dll'), 'utf8'),
      'other64',
    );
    for (const directory of directories)
      for (const name of ['steam_api.dll', 'steam_api64.dll'])
        assert.equal(await fs.readFile(path.join(directory, name), 'utf8'), 'replacement');
    await assert.rejects(fs.access(path.join(game, 'steam_api.dll')), { code: 'ENOENT' });
  }
});

test('integration reinstall finds a nested Steam backup even when the active DLL was deleted', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-metadata-backup-only-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'steam_api64.dll'), 'replacement');
  const zip = path.join(root, 'metadata.zip');
  execFileSync(path.resolve('vendor/7zip/7z.exe'), ['a', zip, '.'], { cwd: source });
  const bytes = await fs.readFile(zip);
  const metadata = new InstallMetadata(root, async () => ({
    ok: true,
    arrayBuffer: async () => bytes,
  }));
  const game = path.join(root, 'game');
  const target = path.join(game, 'Binaries', 'Win64');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'steam_api64_o.dll'), 'original');
  await metadata.apply(game);
  assert.equal(await fs.readFile(path.join(target, 'steam_api64.dll'), 'utf8'), 'replacement');
  assert.equal(await fs.readFile(path.join(target, 'steam_api64_o.dll'), 'utf8'), 'original');
  await assert.rejects(fs.access(path.join(game, 'steam_api64.dll')), { code: 'ENOENT' });
});
