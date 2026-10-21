const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { atomicJson } = require('./catalog.cjs');

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Path escapes the configured game folder.');
  return path.resolve(candidate);
}
async function safePath(root, candidate) {
  const relative = path.relative(path.resolve(root), within(root, candidate));
  const base = await fs.realpath(root);
  const target = within(base, path.join(base, relative));
  let current = base;
  for (const part of path.relative(base, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) break;
    if (stat.isSymbolicLink() || path.relative(await fs.realpath(current), current) !== '')
      throw Error('Unsafe linked game path. Existing files were preserved.');
  }
  return target;
}
function safeName(value) {
  let name = String(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 110);
  if (!name || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = 'Game_' + name;
  return name;
}
async function walk(root, depth = 6) {
  const files = [];
  async function visit(folder, level) {
    if (level > depth) return;
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink())
        throw new Error('Symbolic links in game content are not supported.');
      const file = within(root, path.join(folder, item.name));
      if (item.isDirectory()) {
        if (
          !/^(?:__MACOSX|\.mamba(?:-.*)?|node_modules|redist|_commonredist|directx|vcredist)$/i.test(
            item.name,
          )
        )
          await visit(file, level + 1);
      } else if (item.isFile()) files.push(file);
    }
  }
  await visit(root, 0);
  return files;
}
async function finishFlatten(root, transaction) {
  const holding = await safePath(root, within(root, transaction.holding));
  const nested = within(root, transaction.nested);
  if (!path.basename(holding).startsWith('.mamba-wrapper-'))
    throw Error('Invalid folder cleanup checkpoint.');
  const exists = await fs.lstat(holding).catch(() => null);
  if (exists) {
    for (const name of transaction.children) {
      if (path.basename(name) !== name || name === '..')
        throw Error('Invalid folder cleanup checkpoint.');
      const source = within(holding, path.join(holding, name));
      const destination = await safePath(root, path.join(root, name));
      if (await fs.lstat(source).catch(() => null)) {
        if (await fs.lstat(destination).catch(() => null))
          throw Error('Folder cleanup found a collision. Existing files were preserved.');
        await fs.rename(source, destination);
      } else if (!(await fs.lstat(destination).catch(() => null)))
        throw Error('Folder cleanup requires review.');
    }
    if (transaction.duplicateHelper)
      await fs.unlink(path.join(holding, 'ADD-GAME.cmd')).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    await fs.rmdir(holding);
  } else if (!(await fs.lstat(nested).catch(() => null))) {
    // All moves may have completed before the journal was removed.
    for (const name of transaction.children)
      if (!(await fs.lstat(within(root, path.join(root, name))).catch(() => null)))
        throw Error('Folder cleanup requires review.');
  }
  await fs.rm(path.join(root, '.mamba-flatten.json'), { force: true });
  return { from: nested, to: root };
}
async function flatten(root) {
  const moves = [];
  const journal = path.join(root, '.mamba-flatten.json');
  const pending = await fs.readFile(journal, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (pending) moves.push(await finishFlatten(root, JSON.parse(pending)));
  for (let count = 0; count < 12; count++) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    if (entries.some((entry) => entry.isSymbolicLink()))
      throw new Error('Symbolic links in game content are not supported.');

    if (
      entries.some(
        (entry) =>
          entry.isFile() &&
          /\.(exe|com|bat|cmd|ps1|lnk)$/i.test(entry.name) &&
          !/^(?:setup|install|unins|uninstall|crash|vc_redist|dxsetup|ADD-GAME\.cmd$)/i.test(
            entry.name,
          ),
      )
    )
      break;
    const folders = [];
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      if (/^(?:\.mamba|__MACOSX|_?redist|_commonredist|directx|vcredist|support)/i.test(entry.name))
        continue;
      if ((await fs.readdir(within(root, path.join(root, entry.name)))).length) folders.push(entry);
    }
    if (folders.length !== 1) break;

    if (
      /^(?:binaries|bin|win64|win32|engine|data|content|assets|resources)$/i.test(folders[0].name)
    )
      break;
    const nested = within(root, path.join(root, folders[0].name));
    await walk(nested, 20);
    let children = await fs.readdir(nested);
    let duplicateHelper;
    if (
      children.includes('ADD-GAME.cmd') &&
      entries.some((entry) => entry.name === 'ADD-GAME.cmd')
    ) {
      const outer = await fs.readFile(path.join(root, 'ADD-GAME.cmd'), 'utf8');
      const inner = await fs.readFile(path.join(nested, 'ADD-GAME.cmd'), 'utf8');
      const owned = (text) =>
        text.includes('MAMBA_GAME_FOLDER') || text.includes('run-game-helper.ps1');
      if (owned(outer) && owned(inner)) {
        duplicateHelper = inner;
        children = children.filter((name) => name !== 'ADD-GAME.cmd');
      }
    }
    const collisions = children.filter((name) =>
      entries.some(
        (entry) => entry !== folders[0] && entry.name.toLowerCase() === name.toLowerCase(),
      ),
    );
    if (collisions.length) break;
    const holding = within(
      root,
      path.join(root, '.mamba-wrapper-' + require('node:crypto').randomUUID()),
    );
    await atomicJson(journal, {
      nested,
      holding,
      children,
      duplicateHelper: Boolean(duplicateHelper),
    });
    await fs.rename(nested, holding);
    const moved = [];
    try {
      for (const entry of children) {
        await fs.rename(path.join(holding, entry), within(root, path.join(root, entry)));
        moved.push(entry);
      }
      if (duplicateHelper) await fs.unlink(path.join(holding, 'ADD-GAME.cmd'));
      await fs.rmdir(holding);
      await fs.rm(journal, { force: true });
      moves.push({ from: nested, to: root });
    } catch (error) {
      if (duplicateHelper) await fs.writeFile(path.join(holding, 'ADD-GAME.cmd'), duplicateHelper);
      for (const entry of moved.reverse())
        await fs.rename(path.join(root, entry), path.join(holding, entry));
      await fs.rename(holding, nested);
      await fs.rm(journal, { force: true });
      throw error;
    }
  }
  return moves;
}
async function detect(root) {
  const files = await walk(root);
  const installer =
    files.find((file) =>
      /(^|[-_. ])(setup|install|installer)([-_. ].*)?\.exe$/i.test(path.basename(file)),
    ) ||
    files.find((file) => /\.msi$/i.test(file)) ||
    null;
  const candidates = files.filter(
    (file) =>
      /\.exe$/i.test(file) &&
      !/(^|[\\/])(__?redist|directx|vcredist|support|prerequisites|installer|md5|jre\d*|java)([\\/]|$)/i.test(
        file,
      ) &&
      !/^(unins|uninstall|setup|install|crash|unitycrash|dxsetup|vc_redist|ueprereq|report|update|quicksfv|verify|7z|javaw?\.exe)/i.test(
        path.basename(file),
      ),
  );
  const ranked = await Promise.all(
    candidates.map(async (file) => ({
      file,
      size: (await fs.stat(file)).size,
      score:
        (/shipping\.exe$/i.test(file) ? 30 : 0) +
        (path.dirname(file) === root ? 15 : 0) -
        (/launcher/i.test(path.basename(file)) ? 5 : 0) -
        (/(?:_dev|editor|server)\.exe$/i.test(file) ? 40 : 0),
    })),
  );
  ranked.sort((a, b) => b.score - a.score || b.size - a.size);
  const scripts = files.filter(
    (file) =>
      /\.(bat|cmd|ps1|lnk)$/i.test(file) &&
      !/^(?:unins|uninstall|setup|install|update|ADD-GAME\.cmd$)/i.test(path.basename(file)),
  );
  const startScripts = scripts.filter(
    (file) =>
      !/server/i.test(path.basename(file)) &&
      /^[!_ ]*(?:start|launch|play)(?:[_. -]|$)/i.test(path.basename(file)),
  );
  const launcher =
    startScripts.length === 1
      ? startScripts[0]
      : ranked[0]?.file || (scripts.length === 1 ? scripts[0] : null);
  return {
    installer,
    confidence:
      launcher &&
      (startScripts.length === 1 || ranked.length === 1 || ranked[0]?.score > ranked[1]?.score)
        ? 'high'
        : 'review',
    executable: launcher,
    executables: [
      ...new Set([launcher, ...ranked.map((entry) => entry.file), ...scripts].filter(Boolean)),
    ].slice(0, 30),
  };
}
async function finalizeInstallation(
  folder,
  name,
  { releaseId, executable, status = 'installed', beforeRename, afterRename } = {},
) {
  const root = path.resolve(folder);
  const parent = path.dirname(root);
  const saved = JSON.parse(
    await fs.readFile(path.join(root, '.mamba-game.json'), 'utf8').catch(() => '{}'),
  );
  if (!executable && !(await detect(root)).executable)
    throw new Error('Choose a game launcher with ADD-GAME.cmd before finishing setup.');
  let selected = executable ? within(root, executable) : null;
  for (const move of await flatten(root))
    if (selected && (selected === move.from || selected.startsWith(move.from + path.sep)))
      selected = path.join(move.to, path.relative(move.from, selected));
  const destination = within(parent, path.join(parent, safeName(name)));
  if (destination.toLowerCase() !== root.toLowerCase()) {
    if (await fs.lstat(destination).catch(() => null))
      throw new Error(
        `The folder ${safeName(name)} already exists. Both installations were preserved.`,
      );
    await beforeRename?.(root, destination);
    await fs.rename(root, destination);
    await afterRename?.(destination);
  }
  const actual = destination.toLowerCase() === root.toLowerCase() ? root : destination;
  if (selected) selected = path.join(actual, path.relative(root, selected));
  const found = await detect(actual);
  if (selected && !(await fs.lstat(selected).catch(() => null))?.isFile())
    throw new Error('The selected launcher was not found after folder cleanup.');
  const manifest = {
    ...saved,
    name,
    releaseId: releaseId || saved.releaseId,
    status,
    repairPending: false,
    installedAt: saved.installedAt || new Date().toISOString(),
    executable: selected || found.executable,
  };
  await atomicJson(path.join(actual, '.mamba-game.json'), manifest);
  await require('./game-helper.cjs').installGameHelper(actual);
  return { folder: actual, ...found, executable: manifest.executable, manifest };
}
function run(file, args, { signal, maxOutput = 32 * 1024 * 1024, acceptedCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      shell: false,
      signal,
      cwd: path.dirname(file),
    });
    child.stdin?.end();
    let output = '';
    let errors = '';
    let exceeded = false;
    child.stdout?.on('data', (chunk) => {
      output += chunk;
      if (output.length > maxOutput) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr?.on('data', (chunk) => {
      errors = (errors + chunk).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      acceptedCodes.includes(code) && !exceeded
        ? resolve(output)
        : reject(
            new Error(
              exceeded
                ? 'Archive listing is too large.'
                : `Process failed (${code}): ${(errors + output).slice(-1500)}`,
            ),
          ),
    );
  });
}
function sevenZipPath() {
  if (process.env.MAMBA_7ZIP_PATH) return process.env.MAMBA_7ZIP_PATH;
  const local = path.join(__dirname, '../..', 'vendor', '7zip', '7z.exe');
  if (require('node:fs').existsSync(local)) return local;
  return path.join(process.env.MAMBA_RESOURCES_PATH || process.resourcesPath, '7zip', '7z.exe');
}
function validateArchiveListing(listing, destination) {
  const content = listing.split('----------').slice(1).join('----------');
  if (!content.trim()) throw new Error('Could not inspect archive contents.');
  for (const line of content.split(/\r?\n/)) {
    if (
      /^(Symbolic Link|Hard Link|Copy Link) =[ \t]*\S/i.test(line) ||
      /^Attributes = .*\bl/i.test(line)
    )
      throw new Error('Archive contains links.');
    if (!line.startsWith('Path = ')) continue;
    const name = line.slice(7).replaceAll('\\', '/');
    if (
      name.startsWith('/') ||
      name.includes(':') ||
      name.split('/').some((part) => part === '..' || /^\.mamba(?:-|$)/i.test(part))
    )
      throw new Error('Archive contains an unsafe path.');
    within(destination, path.join(destination, name));
  }
}
async function extractArchive(
  archive,
  destination,
  { signal, password = '', verifiedArchives } = {},
) {
  const seven = sevenZipPath();
  const args = [`-p${password || '__MAMBA_NO_ARCHIVE_PASSWORD__'}`];
  const listing = await run(seven, ['l', '-slt', ...args, '--', archive], { signal });
  validateArchiveListing(listing, destination);
  if (!verifiedArchives?.has(archive))
    await require('./verification.cjs').testArchive(archive, { signal, password });
  await fs.mkdir(destination, { recursive: true });
  const expanded = [...listing.matchAll(/^Size = (\d+)\r?$/gm)].reduce(
    (total, match) => total + Number(match[1]),
    0,
  );
  if (!Number.isSafeInteger(expanded))
    throw new Error('The archive reported an invalid unpacked size.');
  if (expanded)
    await require('./experience.cjs').ensureSpace(destination, expanded, {
      multiplier: 1,
      reserve: 256 * 1024 ** 2,
    });
  await run(seven, ['x', '-y', '-aoa', ...args, `-o${destination}`, '--', archive], { signal });
  await walk(destination, 20);
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
    for (const name of await fs.readdir(downloads)) {
      if (/^\.mamba-transfer$/i.test(name)) continue;
      await fs.cp(path.join(downloads, name), path.join(payload, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
  } else {
    for (const archive of archives) {
      notify(`Extracting ${path.basename(archive)}`);
      await extractArchive(archive, payload, options);
    }
  }
  await flatten(payload);
  for (let depth = 0; depth < 4; depth++) {
    const found = await detect(payload);
    if (found.executable || found.installer) break;
    const nestedArchives = archiveStarts(await walk(payload, 2));
    if (!nestedArchives.length) break;
    const nested = path.join(path.dirname(payload), `unpack-${depth}`);
    for (const archive of nestedArchives) {
      notify(`Extracting ${path.basename(archive)}`);
      await extractArchive(archive, nested, options);
    }
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
  } finally {
    await handle.close();
  }
}
async function autoInstall(installer, destination, signal) {
  const type = await installerType(installer);
  if (!type) return false;
  const args =
    type === 'inno'
      ? ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR=${destination}`]
      : ['/S', `/D=${destination}`];
  await run(installer, args, { signal, acceptedCodes: [0, 3010] });
  return true;
}

class Library {
  constructor(getConfig, { repair, identify, imports = () => [] } = {}) {
    this.imports = imports;
    this.getConfig = getConfig;
    this.repair = repair;
    this.identify = identify;
    this.items = [];
    this.installations = [];
    this.queue = Promise.resolve();
  }
  scan() {
    const task = this.queue.catch(() => {}).then(() => this.performScan());
    this.queue = task;
    return task;
  }
  async performScan() {
    const config = await this.getConfig();
    await fs.mkdir(config.downloadPath, { recursive: true });
    const items = [];
    const entries = (await fs.readdir(config.downloadPath, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'),
      )
      .map((entry) => ({
        name: entry.name,
        folder: within(config.downloadPath, path.join(config.downloadPath, entry.name)),
        imported: false,
      }));
    for (const folder of this.imports())
      if (
        !entries.some(
          (entry) =>
            path.resolve(entry.folder).toLowerCase() === path.resolve(folder).toLowerCase(),
        )
      )
        entries.push({ name: path.basename(folder), folder: path.resolve(folder), imported: true });
    for (const entry of entries) {
      let folder = entry.folder;
      try {
        let manifest = {};
        try {
          manifest = JSON.parse(await fs.readFile(path.join(folder, '.mamba-game.json'), 'utf8'));
        } catch {}
        if (manifest.name)
          await require('./game-helper.cjs')
            .installGameHelper(folder)
            .catch(() => {});
        let found = await detect(folder);
        if (manifest.repairPending && this.repair && !entry.imported) {
          try {
            const repaired = await this.repair({ folder, manifest, found });
            if (repaired) {
              folder = repaired.folder;
              found = repaired;
              manifest = repaired.manifest;
            }
          } catch {}
        }
        if (!found.executable && !found.installer && !manifest.name) continue;
        const id = require('node:crypto')
          .createHash('sha256')
          .update(folder)
          .digest('hex')
          .slice(0, 24);
        let executable = found.executable;
        if (manifest.executable) {
          const candidate = within(folder, path.resolve(folder, manifest.executable));
          if ((await fs.lstat(candidate).catch(() => null))?.isFile()) executable = candidate;
        }
        items.push({
          id,
          name: manifest.name || entry.name,
          folder,
          imported: entry.imported,
          releaseId: manifest.releaseId || null,
          version: manifest.version || null,
          installedAt: manifest.installedAt || null,
          launcherSelected: !!manifest.launcherSelected,
          executable,
          installer: found.installer,
          repairPending: Boolean(manifest.repairPending),
          status:
            !manifest.setupInterrupted && manifest.status !== 'needs-setup' && executable
              ? 'installed'
              : 'needs-setup',
          executables: found.executables,
        });
      } catch {}
    }
    if (this.identify) {
      const grouped = await require('./game-identity.cjs').groupInstallations(items, this.identify);
      this.items = grouped.items;
      this.installations = grouped.installations;
    } else {
      this.items = items.sort((a, b) => a.name.localeCompare(b.name));
      this.installations = this.items;
    }
    return this.items;
  }
  get(id) {
    return (
      this.items.find((game) => game.id === id) || this.installations.find((game) => game.id === id)
    );
  }
}
module.exports = {
  Library,
  within,
  safePath,
  safeName,
  walk,
  flatten,
  detect,
  finalizeInstallation,
  run,
  validateArchiveListing,
  extractArchive,
  sevenZipPath,
  archiveStarts,
  unpack,
  autoInstall,
  atomicJson,
};
