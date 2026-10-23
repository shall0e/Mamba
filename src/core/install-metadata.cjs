const fs = require('node:fs/promises');
const path = require('node:path');
const { extractArchive, safePath } = require('./library.cjs');

const ARCHIVE_URL = 'https://raw.githubusercontent.com/shall0e/Mamba/main/metadata.zip';

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
    const response = await this.fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok)
      throw Error('Could not download installation metadata: HTTP ' + response.status);
    const archive = path.join(this.directory, 'metadata.zip');
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    return archive;
  }

  async apply(folder) {
    const archive = await this.load();
    const destination = await safePath(folder, folder);
    await fs.mkdir(destination, { recursive: true });
    const targets = new Set();
    const visit = async (directory) => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && /^steam_api(?:64)?\.dll$/i.test(entry.name)) {
          const backup = path.join(directory, entry.name.replace(/\.dll$/i, '_o.dll'));
          try {
            await fs.lstat(backup);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await fs.rename(file, backup);
          }
          targets.add(directory);
        }
      }
    };
    await visit(destination);
    // Retain root extraction for games that do not ship a Steam API DLL.
    if (!targets.size) targets.add(destination);
    for (const target of targets) await extractArchive(archive, target);
    return destination;
  }
}

module.exports = { InstallMetadata };
