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
    await extractArchive(archive, destination);
    return destination;
  }
}

module.exports = { InstallMetadata };
