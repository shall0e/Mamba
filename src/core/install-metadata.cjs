const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { extractArchive, safePath } = require('./library.cjs');
const ARCHIVE_SHA256 = '03ca2dd16d569a5cd15ddf2be94516bbe7ea109118013f3fce778e40f8fda775';
const ARCHIVE_URL =
  'https://raw.githubusercontent.com/Shall0e/Mamba/e0768bef0f73d5b98a80739cce55ed289348c71b/metadata.zip';
const FILES = ['source-inventory.csv', 'metadata.json'];
function validateMetadata(files) {
  if (
    Object.keys(files).length !== FILES.length ||
    FILES.some((name) => !Buffer.isBuffer(files[name]))
  )
    throw Error('Metadata package must contain only the reviewed metadata files.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const name of FILES) {
    if (files[name].length > 1024 * 1024) throw Error('Metadata file is too large.');
    const text = decoder.decode(files[name]);
    if (text.includes('\0')) throw Error('Metadata must contain text only.');
    if (name.endsWith('.json') && text.trim()) {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Invalid metadata object.');
    }
    if (name.endsWith('.csv') && !text.startsWith('"Path","Bytes","Extension"'))
      throw Error('Invalid source inventory.');
  }
  return files;
}
class InstallMetadata {
  constructor(directory, transport = fetch) {
    this.directory = path.join(directory, 'install-metadata');
    this.fetch = transport;
    this.pending = null;
  }
  load() {
    if (!this.pending)
      this.pending = this.readPackage().catch((error) => {
        this.pending = null;
        throw error;
      });
    return this.pending;
  }
  async readPackage() {
    await fs.mkdir(this.directory, { recursive: true });
    const cached = path.join(this.directory, ARCHIVE_SHA256 + '.zip');
    let archive = await fs.readFile(cached).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!archive) {
      const response = await this.fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(15000) });
      if (!response.ok)
        throw Error('Could not download installation metadata: HTTP ' + response.status);
      archive = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(archive).digest('hex') !== ARCHIVE_SHA256)
        throw Error('Installation metadata differs from the reviewed archive.');
      const temporary = cached + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, archive);
        await fs.rename(temporary, cached);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    if (createHash('sha256').update(archive).digest('hex') !== ARCHIVE_SHA256)
      throw Error(
        'Cached installation metadata is corrupt. Remove its ZIP from AppData and retry.',
      );
    const temporary = await fs.mkdtemp(path.join(this.directory, 'unpack-'));
    try {
      await extractArchive(cached, temporary);
      const names = await fs.readdir(temporary);
      const files = {};
      for (const name of names) {
        if (!FILES.includes(name) || !(await fs.lstat(path.join(temporary, name))).isFile())
          throw Error('Unexpected installation metadata contents.');
        files[name] = await fs.readFile(path.join(temporary, name));
      }
      return validateMetadata(files);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  async apply(folder) {
    const files = await this.load();
    const destination = await safePath(folder, folder);
    await fs.mkdir(destination, { recursive: true });
    for (const name of FILES) {
      const target = await safePath(folder, path.join(destination, name));
      const previous = await fs.readFile(target).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (previous?.equals(files[name])) continue;
      const temporary = await safePath(folder, target + '.' + randomUUID() + '.tmp');
      try {
        await fs.writeFile(temporary, files[name]);
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    return destination;
  }
}
module.exports = { InstallMetadata, validateMetadata };
