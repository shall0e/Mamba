const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { within } = require('./library.cjs');

const DAY = 86400000;
const FINAL_JOBS = new Set(['completed', 'cancelled']);
const ARCHIVE = /\.(?:zip|rar|7z|tar|gz|bz2|xz|iso|r\d{2}|z\d{2}|7z\.\d{3}|zip\.\d{3}|part)$/i;
const INSTALLER = /^(?:setup|install|installer)(?:[-_. ].*)?\.(?:exe|msi|bin)$/i;
const SUPPORT = /\.(?:txt|nfo|sfv|md5|sha256|sha1|url|jpg|png)$/i;
const same = (left, right) =>
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const contains = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    !relative ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
};

class FileCleanup {
  constructor(state) {
    this.state = state;
    this.plan = null;
    this.removing = false;
    this.scanPending = null;
  }

  async protected(target, root) {
    for (const source of this.state.games()) {
      const game = {
        ...source,
        folder: source.folder
          ? await fs.realpath(source.folder).catch(() => path.resolve(source.folder))
          : null,
      };
      if (game.folder && (contains(game.folder, target) || contains(target, game.folder)))
        return true;
    }
    for (const source of this.state.jobs()) {
      const job = {
        ...source,
        root: source.root
          ? await fs.realpath(source.root).catch(() => path.resolve(source.root))
          : null,
        folder: source.folder
          ? await fs.realpath(source.folder).catch(() => path.resolve(source.folder))
          : null,
      };
      if (job.folder && (contains(job.folder, target) || contains(target, job.folder))) return true;
      if (!FINAL_JOBS.has(job.status) && job.root && job.id) {
        const stage = path.join(job.root, '.mamba-downloads', String(job.id));
        if (contains(stage, target) || contains(target, stage)) return true;
      }
    }
    return same(target, root);
  }

  async inspect(root, target) {
    within(root, target);
    if (same(root, target)) throw Error('The Games folder cannot be cleaned as one item.');
    const hash = createHash('sha256');
    let size = 0,
      files = 0,
      newest = 0,
      removableOnly = true,
      payloads = 0;
    const visit = async (file, depth) => {
      if (depth > 24 || ++files > 50000) throw Error('Folder is too large to inspect safely.');
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw Error('Linked or special files are not cleanup candidates.');
      if (!same(await fs.realpath(file), file))
        throw Error('The cleanup path changed. Scan again.');
      newest = Math.max(newest, stat.mtimeMs);
      hash.update(JSON.stringify([path.relative(root, file), stat.ino, stat.size, stat.mtimeMs]));
      if (stat.isDirectory()) {
        for (const entry of (await fs.readdir(file)).sort())
          await visit(within(root, path.join(file, entry)), depth + 1);
      } else {
        size += stat.size;
        const name = path.basename(file);
        if (ARCHIVE.test(name) || INSTALLER.test(name)) payloads++;
        else if (!SUPPORT.test(name)) removableOnly = false;
      }
    };
    await visit(target, 0);
    return { size, files, newest, removableOnly, payloads, signature: hash.digest('hex') };
  }

  scan() {
    if (this.removing) return Promise.reject(Error('Wait for cleanup to finish.'));
    if (!this.scanPending)
      this.scanPending = this.performScan().finally(() => {
        this.scanPending = null;
      });
    return this.scanPending;
  }

  async performScan() {
    if (this.removing) throw Error('Wait for cleanup to finish.');
    const root = await fs.realpath(this.state.root());
    const candidates = [],
      errors = [];
    const add = async (target, kind, name, sourceOnly = false) => {
      if (candidates.length >= 250 || (await this.protected(target, root))) return;
      try {
        const info = await this.inspect(root, target);
        if (
          info.newest > Date.now() - DAY ||
          (sourceOnly && (!info.removableOnly || !info.payloads))
        )
          return;
        candidates.push({
          id: randomUUID(),
          path: target,
          relative: path.relative(root, target),
          name,
          kind,
          bytes: info.size,
          modified: new Date(info.newest).toISOString(),
          signature: info.signature,
        });
      } catch (error) {
        if (error.code !== 'ENOENT') errors.push(path.relative(root, target));
      }
    };
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const target = within(root, path.join(root, entry.name));
      if (entry.name === '.mamba-downloads' && entry.isDirectory()) {
        for (const stage of await fs.readdir(target, { withFileTypes: true })) {
          if (!stage.isDirectory() || !/^[a-f0-9-]{36}$/i.test(stage.name)) continue;
          const job = this.state
            .jobs()
            .find((job) => job.id === stage.name && job.root && same(job.root, root));
          if (job && !FINAL_JOBS.has(job.status)) continue;
          await add(
            path.join(target, stage.name),
            job ? 'Download leftovers' : 'Old temporary download',
            job?.name || stage.name,
          );
        }
      } else if (entry.isFile() && (ARCHIVE.test(entry.name) || INSTALLER.test(entry.name))) {
        await add(
          target,
          ARCHIVE.test(entry.name) ? 'Archive / partial file' : 'Installer file',
          entry.name,
        );
      } else if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !(await this.protected(target, root))
      ) {
        const entries = await fs.readdir(target).catch(() => null);
        if (entries?.length === 0) await add(target, 'Empty folder', entry.name);
        else if (entries) await add(target, 'Installer / archive folder', entry.name, true);
      }
    }
    candidates.sort((a, b) => b.bytes - a.bytes);
    this.plan = { id: randomUUID(), root, at: Date.now(), candidates };
    return {
      id: this.plan.id,
      root,
      items: candidates.map(({ signature, ...item }) => item),
      skipped: errors.length,
      limited: candidates.length >= 250,
    };
  }

  async selection(scanId, ids) {
    if (this.scanPending) throw Error('A new cleanup scan is in progress. Wait for it to finish.');
    if (!this.plan || this.plan.id !== scanId || Date.now() - this.plan.at > 10 * 60000)
      throw Error('This cleanup scan expired. Scan again.');
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 250 ||
      ids.some((id) => typeof id !== 'string')
    )
      throw Error('Select files to clean up.');
    const selected = [...new Set(ids)].map((id) =>
      this.plan.candidates.find((item) => item.id === id),
    );
    if (selected.some((item) => !item)) throw Error('The cleanup selection changed. Scan again.');
    const root = await fs.realpath(this.state.root());
    if (!same(root, this.plan.root)) throw Error('The Games folder changed. Scan again.');
    return { root, selected };
  }

  async validate(root, item) {
    if (await this.protected(item.path, root))
      throw Error('This folder belongs to a game or an unfinished download.');
    const current = await this.inspect(root, item.path);
    if (current.signature !== item.signature || current.newest > Date.now() - DAY)
      throw Error('These files changed after the scan. Scan again.');
  }

  async preview(scanId, ids) {
    const { root, selected } = await this.selection(scanId, ids);
    for (const item of selected) await this.validate(root, item);
    return {
      count: selected.length,
      bytes: selected.reduce((total, item) => total + item.bytes, 0),
      paths: selected.map((item) => item.path),
    };
  }

  async remove(scanId, ids) {
    if (this.removing) throw Error('Cleanup is already running.');
    this.removing = true;
    try {
      const { root, selected } = await this.selection(scanId, ids);
      const removed = [],
        failures = [];
      let bytes = 0;
      for (const item of selected) {
        try {
          await this.validate(root, item);
          await fs.rm(item.path, { recursive: true, force: false, maxRetries: 2, retryDelay: 200 });
          removed.push(item.id);
          bytes += item.bytes;
        } catch (error) {
          failures.push({
            id: item.id,
            name: item.name,
            message:
              error.code === 'ENOENT'
                ? 'Already removed. Scan again.'
                : error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY'
                  ? 'File is in use or access was denied. Close the installer and scan again.'
                  : error.message,
          });
        }
      }
      this.plan.candidates = this.plan.candidates.filter((item) => !removed.includes(item.id));
      return { removed, bytes, failures };
    } finally {
      this.removing = false;
    }
  }
}
module.exports = { FileCleanup };
