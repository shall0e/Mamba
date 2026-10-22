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
