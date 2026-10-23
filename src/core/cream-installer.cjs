const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const bundledRelease = require('../shared/cream-installer-release.json');

const REPOSITORY = 'https://github.com/FroggMaster/CreamInstaller';
const LATEST = 'https://api.github.com/repos/FroggMaster/CreamInstaller/releases/latest';
const DAY = 24 * 60 * 60 * 1000;

function validateRelease(release) {
  if (
    !release ||
    !/^v\d+(?:\.\d+){1,3}$/.test(release.version) ||
    !/^[a-f0-9]{64}$/.test(release.sha256) ||
    !Number.isSafeInteger(release.size) ||
    release.size <= 0 ||
    release.size > 512 * 1024 ** 2 ||
    release.url !== `${REPOSITORY}/releases/download/${release.version}/CreamInstaller.exe`
  )
    throw Error('CreamInstaller release could not be verified.');
  return {
    version: release.version,
    url: release.url,
    sha256: release.sha256,
    size: release.size,
    source: `${REPOSITORY}/archive/refs/tags/${release.version}.zip`,
  };
}
function newer(a, b) {
  const left = a.slice(1).split('.').map(Number),
    right = b.slice(1).split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0);
  }
  return false;
}
async function verified(file, release) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== release.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === release.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function download(release, destination, transport = fetch) {
  release = validateRelease(release);
  if (await verified(destination, release)) return destination;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + '.' + randomUUID() + '.tmp';
  try {
    const response = await transport(release.url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
    if (!response.ok || !response.body)
      throw Error('Could not download CreamInstaller: HTTP ' + response.status);
    const hash = createHash('sha256');
    let size = 0;
    const check = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > release.size)
          return callback(Error('CreamInstaller download has an unexpected size.'));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      check,
      createWriteStream(temporary, { flags: 'wx' }),
    );
    if (size !== release.size || hash.digest('hex') !== release.sha256)
      throw Error('CreamInstaller download failed verification.');
    await fs.rename(temporary, destination);
    return destination;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function launchExecutable(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [], {
      cwd: path.dirname(file),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}
class CreamInstaller extends EventEmitter {
  constructor({
    directory,
    resources,
    getConfig,
    transport = fetch,
    launch = launchExecutable,
    release = bundledRelease,
    now = Date.now,
  }) {
    super();
    this.directory = path.join(directory, 'tools', 'creaminstaller');
    this.resources = resources;
    this.getConfig = getConfig;
    this.fetch = transport;
    this.launch = launch;
    this.bundled = validateRelease(release);
    this.now = now;
    this.state = { version: this.bundled.version, status: 'ready', message: 'Bundled with Mamba.' };
  }
  set(patch) {
    Object.assign(this.state, patch);
    this.emit('change', { ...this.state });
  }
  executable(release) {
    return path.join(
      this.directory,
      `${release.version}-${release.sha256.slice(0, 12)}`,
      'CreamInstaller.exe',
    );
  }
  async save() {
    const file = path.join(this.directory, 'current.json');
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify({ release: this.current, checkedAt: this.checkedAt || 0 }) + '\n',
      );
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  initialize() {
    if (!this.initializing)
      this.initializing = this.seed().catch((error) => {
        this.initializing = null;
        throw error;
      });
    return this.initializing;
  }
  async seed() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const saved = JSON.parse(
        await fs.readFile(path.join(this.directory, 'current.json'), 'utf8'),
      );
      const release = validateRelease(saved.release);
      if (
        !newer(this.bundled.version, release.version) &&
        (await verified(this.executable(release), release))
      ) {
        this.current = release;
        this.checkedAt =
          Number.isFinite(saved.checkedAt) && saved.checkedAt <= this.now() ? saved.checkedAt : 0;
      }
    } catch (error) {
      if (
        !['ENOENT'].includes(error.code) &&
        !(error instanceof SyntaxError) &&
        !/could not be verified/.test(error.message)
      )
        throw error;
    }
    if (!this.current) {
      const source = path.join(this.resources, 'CreamInstaller.exe');
      if (!(await verified(source, this.bundled)))
        throw Error('The bundled CreamInstaller is missing or damaged. Reinstall Mamba.');
      const destination = this.executable(this.bundled);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
      this.current = this.bundled;
      await this.save();
    }
    this.set({
      version: this.current.version,
      status: 'ready',
      message: 'CreamInstaller is ready.',
    });
    return { ...this.state };
  }
  check(manual = false) {
    if (!this.pending)
      this.pending = this.performCheck(manual).finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  async performCheck(manual) {
    try {
      await this.initialize();
      const config = await this.getConfig();
      if (
        !manual &&
        (config.automaticUpdates === false || this.now() - (this.checkedAt || 0) < DAY)
      )
        return { ...this.state };
      this.set({ status: 'checking', message: 'Checking CreamInstaller updates…' });
      const response = await this.fetch(LATEST, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok)
        throw Error('Could not check CreamInstaller updates: HTTP ' + response.status);
      const data = await response.json();
      if (data.draft || data.prerelease)
        throw Error('No stable CreamInstaller release is available.');
      const asset = data.assets?.find((item) => item.name === 'CreamInstaller.exe');
      const release = validateRelease({
        version: data.tag_name,
        url: asset?.browser_download_url,
        size: asset?.size,
        sha256: String(asset?.digest || '').replace(/^sha256:/, ''),
      });
      if (newer(release.version, this.current.version)) {
        this.set({
          status: 'downloading',
          message: 'Downloading CreamInstaller ' + release.version + '…',
        });
        await download(release, this.executable(release), this.fetch);
        this.current = release;
      }
      this.checkedAt = this.now();
      await this.save();
      this.set({
        version: this.current.version,
        status: 'ready',
        message: 'CreamInstaller is up to date.',
      });
    } catch (error) {
      this.set({ status: 'error', message: error.message });
    }
    return { ...this.state };
  }
  async open() {
    await this.initialize();
    await this.launch(this.executable(this.current));
    return { ...this.state };
  }
  start() {
    this.initial = setTimeout(() => this.check().catch(() => {}), 15000);
    this.interval = setInterval(() => this.check().catch(() => {}), 6 * 60 * 60 * 1000);
  }
  stop() {
    clearTimeout(this.initial);
    clearInterval(this.interval);
  }
}
module.exports = { CreamInstaller, download, verified, validateRelease, newer };
