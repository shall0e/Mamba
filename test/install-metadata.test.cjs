const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { InstallMetadata, validateMetadata } = require('../src/core/install-metadata.cjs');
const files = () => ({
  'source-inventory.csv': Buffer.from('"Path","Bytes","Extension"\r\n'),
  'metadata.json': Buffer.alloc(0),
});
test('only the reviewed text metadata formats are accepted', () => {
  assert.ok(validateMetadata(files()));
  assert.throws(() => validateMetadata({ ...files(), 'unexpected.bin': Buffer.from('x') }), /only/);
  assert.throws(() => validateMetadata({ ...files(), 'metadata.json': Buffer.from([0xff]) }));
  assert.throws(
    () => validateMetadata({ ...files(), 'metadata.json': Buffer.from('MZ\0') }),
    /text/,
  );
});
test('metadata is added to every game root, restores missing files, and replaces changed files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-install-metadata-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const installer = new InstallMetadata(dir, () => assert.fail('No network expected'));
  installer.readPackage = async () => files();
  for (const name of ['First', 'Second']) {
    const folder = path.join(dir, name);
    await fs.mkdir(folder);
    const destination = await installer.apply(folder);
    assert.equal(destination, folder);
    await fs.unlink(path.join(destination, 'metadata.json'));
    await installer.apply(folder);
    assert.equal(await fs.readFile(path.join(destination, 'metadata.json'), 'utf8'), '');
    assert.deepEqual((await fs.readdir(destination)).sort(), [
      'metadata.json',
      'source-inventory.csv',
    ]);
    await fs.writeFile(path.join(folder, 'metadata.json'), '{"existing":true}');
    await installer.apply(folder);
    assert.equal(await fs.readFile(path.join(folder, 'metadata.json'), 'utf8'), '');
  }
});
test('unreviewed downloads are rejected without caching or installing files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-metadata-integrity-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const installer = new InstallMetadata(dir, async () => new Response('unreviewed archive'));
  await assert.rejects(installer.load(), /differs from the reviewed/);
  assert.deepEqual(await fs.readdir(installer.directory), []);
});
