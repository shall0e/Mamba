const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { atomicJson } = require('./catalog.cjs');

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Path escapes the configured game folder.');
  return path.resolve(candidate);
}
function safeName(value) {
  let name = String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 110);
  if (!name || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = 'Game_' + name;
  return name;
}
async function walk(root, depth = 6) {
  const files = [];
  async function visit(folder, level) {
    if (level > depth) return;
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('Symbolic links in game content are not supported.');
      const file = within(root, path.join(folder, item.name));
      if (item.isDirectory()) {
        if (!/^(__MACOSX|\.mamba|node_modules|redist|_commonredist|directx|vcredist)$/i.test(item.name)) await visit(file, level + 1);
      } else if (item.isFile()) files.push(file);
    }
  }
  await visit(root, 0); return files;
}
async function flatten(root) {
  for (let count = 0; count < 12; count++) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].isSymbolicLink()) break;
    const nested = within(root, path.join(root, entries[0].name));
    const holding = within(root, path.join(root, '.mamba-wrapper-' + require('node:crypto').randomUUID()));
    await fs.rename(nested, holding);
    for (const entry of await fs.readdir(holding)) await fs.rename(path.join(holding, entry), within(root, path.join(root, entry)));
    await fs.rmdir(holding);
  }
}
async function detect(root) {
  const files = await walk(root);
  const installer = files.find((file) => /(^|[-_. ])(setup|install|installer)([-_. ].*)?\.exe$/i.test(path.basename(file))) || files.find((file) => /\.msi$/i.test(file)) || null;
  const candidates = files.filter((file) => /\.exe$/i.test(file) && !/(^|[\\/])(__?redist|directx|vcredist|support|prerequisites|installer)([\\/]|$)/i.test(file) && !/^(unins|uninstall|setup|install|crash|unitycrash|dxsetup|vc_redist|ueprereq|report|update)/i.test(path.basename(file)));
  const ranked = await Promise.all(candidates.map(async (file) => ({ file, size: (await fs.stat(file)).size, score: (/shipping\.exe$/i.test(file) ? 30 : 0) + (path.dirname(file) === root ? 15 : 0) - (/launcher/i.test(path.basename(file)) ? 5 : 0) })));
  ranked.sort((a, b) => b.score - a.score || b.size - a.size);
  return { installer, executable: ranked[0]?.file || null, executables: ranked.slice(0, 30).map((entry) => entry.file) };
}
function run(file, args, { signal, maxOutput = 32 * 1024 * 1024, acceptedCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false, signal, cwd: path.dirname(file) });
    child.stdin?.end();
    let output = ''; let errors = ''; let exceeded = false;
    child.stdout?.on('data', (chunk) => { output += chunk; if (output.length > maxOutput) { exceeded = true; child.kill(); } });
    child.stderr?.on('data', (chunk) => { errors = (errors + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => acceptedCodes.includes(code) && !exceeded ? resolve(output) : reject(new Error(exceeded ? 'Archive listing is too large.' : `Process failed (${code}): ${errors.slice(-300)}`)));
  });
}
function sevenZipPath() {
  const local = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  if (require('node:fs').existsSync(local)) return local;
  return path.join(process.resourcesPath, '7zip', '7z.exe');
}
async function extractArchive(archive, destination, { signal, password = '' } = {}) {
  const seven = sevenZipPath();
  const args = [`-p${password || '__MAMBA_NO_ARCHIVE_PASSWORD__'}`];
  const listing = await run(seven, ['l', '-slt', ...args, '--', archive], { signal });
  const content = listing.split('----------').slice(1).join('----------');
  if (!content.trim()) throw new Error('Could not inspect archive contents.');
  for (const line of content.split(/\r?\n/)) {
    if (/^(Symbolic Link|Hard Link) = /i.test(line) || /^Attributes = .*\bl/i.test(line)) throw new Error('Archive contains links.');
    if (!line.startsWith('Path = ')) continue;
    const name = line.slice(7).replaceAll('\\', '/');
    if (name.startsWith('/') || name.includes(':') || name.split('/').includes('..')) throw new Error('Archive contains an unsafe path.');
    within(destination, path.join(destination, name));
  }
  await fs.mkdir(destination, { recursive: true });
  await run(seven, ['x', '-y', '-aoa', ...args, `-o${destination}`, '--', archive], { signal });
  await walk(destination, 20); // Check extracted entries before any moves or execution.
}
function archiveStarts(files) {
  return files.filter((file) => {
    const name = path.basename(file);
    if (/\.part\d+\.rar$/i.test(name)) return /\.part0*1\.rar$/i.test(name);
    return /\.(zip|7z|rar)$/i.test(name) || /\.(7z|zip)\.001$/i.test(name);
  });
}
async function unpack(downloads, payload, options, notify) {
  await fs.mkdir(payload, { recursive: true });
  const files = await walk(downloads);
  const initial = await detect(downloads);
  const archives = initial.installer || initial.executable ? [] : archiveStarts(files);
  if (!archives.length) {
    for (const name of await fs.readdir(downloads)) await fs.cp(path.join(downloads, name), path.join(payload, name), { recursive: true, errorOnExist: true, force: false });
  } else {
    for (const archive of archives) { notify(`Extracting ${path.basename(archive)}`); await extractArchive(archive, payload, options); }
  }
  await flatten(payload);
  for (let depth = 0; depth < 4; depth++) {
    const found = await detect(payload);
    if (found.executable || found.installer) break;
    const nestedArchives = archiveStarts(await walk(payload, 2));
    if (!nestedArchives.length) break;
    const nested = path.join(path.dirname(payload), `unpack-${depth}`);
    for (const archive of nestedArchives) { notify(`Extracting ${path.basename(archive)}`); await extractArchive(archive, nested, options); }
    const old = path.join(path.dirname(payload), `archive-layer-${depth}`);
    await fs.rename(payload, old);
    await fs.rename(nested, payload);
    await flatten(payload);
  }
  return detect(payload);
}
async function installerType(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const first = Buffer.alloc(Math.min(size, 8 * 1024 * 1024));
    await handle.read(first, 0, first.length, 0);
    const tail = Buffer.alloc(Math.min(size, 1024 * 1024));
    await handle.read(tail, 0, tail.length, Math.max(0, size - tail.length));
    const text = first.toString('latin1') + tail.toString('latin1');
    if (/Inno Setup Setup Data|Inno Setup/.test(text)) return 'inno';
    if (/NullsoftInst|Nullsoft Install System/.test(text)) return 'nsis';
    return null;
  } finally { await handle.close(); }
}
async function autoInstall(installer, destination, signal) {
  const type = await installerType(installer);
  if (!type) return false;
  const args = type === 'inno' ? ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR=${destination}`] : ['/S', `/D=${destination}`];
  await run(installer, args, { signal, acceptedCodes: [0, 3010] });
  return true;
}

class Library {
  constructor(getConfig) { this.getConfig = getConfig; this.items = []; this.queue = Promise.resolve(); }
  async scan() {
    const config = await this.getConfig();
    await fs.mkdir(config.downloadPath, { recursive: true });
    const items = [];
    for (const entry of await fs.readdir(config.downloadPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const folder = within(config.downloadPath, path.join(config.downloadPath, entry.name));
      try {
        let manifest = {};
        try { manifest = JSON.parse(await fs.readFile(path.join(folder, '.mamba-game.json'), 'utf8')); } catch {}
        const found = await detect(folder);
        if (!found.executable && !found.installer && !manifest.name) continue;
        const id = require('node:crypto').createHash('sha256').update(folder).digest('hex').slice(0, 24);
        let executable = found.executable;
        if (manifest.executable) {
          const candidate = within(folder, manifest.executable);
          if ((await fs.lstat(candidate).catch(() => null))?.isFile()) executable = candidate;
        }
        items.push({ id, name: manifest.name || entry.name, folder, executable, installer: found.installer, status: manifest.status === 'installed' && executable ? 'installed' : found.executable && !found.installer ? 'installed' : 'needs-setup', executables: found.executables });
      } catch { /* One unreadable folder does not hide the rest of the library. */ }
    }
    this.items = items.sort((a, b) => a.name.localeCompare(b.name)); return this.items;
  }
  get(id) { return this.items.find((game) => game.id === id); }
}
module.exports = { Library, within, safeName, walk, flatten, detect, run, extractArchive, unpack, autoInstall, atomicJson };
