const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { TorBox, delay } = require('./torbox.cjs');
const { within, safeName, unpack, autoInstall, detect, atomicJson } = require('./library.cjs');

async function downloadFile(url, destination, expected, signal, onProgress, transport = fetch) {
  const partial = destination + '.part';
  await fs.mkdir(path.dirname(destination), { recursive: true });
  let start = await fs.stat(partial).then((stat) => stat.size).catch(() => 0);
  const finished = await fs.stat(destination).catch(() => null);
  if (finished && expected > 0 && finished.size === expected) { onProgress(finished.size, expected); return; }
  if (expected > 0 && start === expected) { await fs.rename(partial, destination); onProgress(start, expected); return; }
  let response = await transport(url, { signal, headers: start ? { Range: `bytes=${start}-` } : {} });
  if (response.status === 416 && start) {
    start = 0;
    response = await transport(url, { signal });
  }
  if (!response.ok || !response.body) throw new Error(`File download failed (${response.status}).`);
  if (response.status !== 206) start = 0;
  if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${start}-`)) throw new Error('Invalid download resume response.');
  const total = expected || (Number(response.headers.get('content-length')) + start);
  let bytes = start;
  const progress = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; onProgress(bytes, total); callback(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: start ? 'a' : 'w' }), { signal });
  if (total > 0 && bytes !== total) throw new Error('Download was incomplete. Retry to resume it.');
  await fs.rename(partial, destination);
}

class Downloads extends EventEmitter {
  constructor(directory, getConfig, catalog, library, { transport = fetch, apiFactory = (key) => new TorBox(key, transport) } = {}) {
    super(); this.file = path.join(directory, 'downloads.json'); this.getConfig = getConfig; this.catalog = catalog; this.library = library;
    this.fetch = transport; this.apiFactory = apiFactory; this.jobs = []; this.running = false; this.controllers = new Map(); this.persistQueue = Promise.resolve(); this.lastProgress = 0;
    this.bestPending = new Map();
  }
  snapshot() { return this.jobs.map(({ uri, ...job }) => job); }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.jobs = Array.isArray(saved) ? saved.filter((job) => /^[a-f0-9-]{36}$/i.test(job.id)).map((job) => ['completed', 'cancelled', 'failed', 'needs-setup', 'paused'].includes(job.status) ? job : { ...job, status: 'paused', message: 'Interrupted. Retry to resume.' }) : [];
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  persist() {
    this.persistQueue = this.persistQueue.catch(() => {}).then(() => atomicJson(this.file, this.jobs));
    return this.persistQueue;
  }
  async update(job, patch, progressOnly = false) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    if (progressOnly && Date.now() - this.lastProgress < 300) return;
    this.lastProgress = Date.now();
    this.emit('change', this.snapshot());
    if (!progressOnly) await this.persist();
  }
  startBest(id) {
    if (this.bestPending.has(id)) return this.bestPending.get(id);
    const task = this.catalog.resolveGame(id).then((game) => {
      if (!game.best) throw new Error(game.message || 'No compatible download is currently available.');
      return this.start(game.best.gameId, game.best.linkIndex, game.name);
    });
    this.bestPending.set(id, task);
    task.finally(() => this.bestPending.delete(id)).catch(() => {});
    return task;
  }
  async start(gameId, option = 0, displayName) {
    const game = this.catalog.byId.get(gameId);
    if (!game) throw new Error('This release is no longer in the catalog. Search again.');
    const link = game.links[Number(option)];
    if (!link) throw new Error('Choose a download option.');
    const config = await this.getConfig();
    if (!config.torboxApiKey) throw new Error('Add your TorBox API key first.');
    const existing = this.jobs.find((job) => job.gameId === game.id && !['failed', 'cancelled'].includes(job.status));
    if (existing) return existing.id;
    const job = { id: randomUUID(), gameId: game.id, name: displayName || game.name, uri: link.uri, status: 'queued', message: 'Waiting to download', progress: 0, received: 0, total: 0, createdAt: new Date().toISOString(), root: path.resolve(config.downloadPath) };
    this.jobs.unshift(job); await this.persist(); this.emit('change', this.snapshot()); this.pump(); return job.id;
  }
  async cancel(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || ['completed', 'needs-setup', 'cancelled'].includes(job.status)) return;
    this.controllers.get(id)?.abort();
    await this.update(job, { status: 'cancelled', message: 'Cancelled. Partial files kept for retry.' });
  }
  async retry(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !['paused', 'failed', 'cancelled'].includes(job.status)) throw new Error('This download cannot be retried yet.');
    for (let i = 0; this.controllers.has(id) && i < 50; i++) await delay(100);
    if (this.controllers.has(id)) throw new Error('Cancellation is still finishing. Try again in a moment.');
    await this.update(job, { status: 'queued', message: 'Queued to resume' }); this.pump();
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      let job;
      while ((job = this.jobs.find((entry) => entry.status === 'queued'))) {
        const controller = new AbortController(); this.controllers.set(job.id, controller);
        try { await this.execute(job, controller.signal); }
        catch (error) {
          await this.update(job, { status: controller.signal.aborted ? 'cancelled' : 'failed', message: controller.signal.aborted ? 'Cancelled. Partial files kept for retry.' : error.message.slice(0, 400) });
        } finally { this.controllers.delete(job.id); }
      }
    } finally { this.running = false; }
  }
  async execute(job, signal) {
    const config = await this.getConfig();
    const api = this.apiFactory(config.torboxApiKey);
    const stage = within(job.root, path.join(job.root, '.mamba-downloads', job.id));
    const raw = path.join(stage, 'raw'); const payload = path.join(stage, 'payload');
    await fs.mkdir(raw, { recursive: true });
    const destination = within(job.root, path.join(job.root, `${safeName(job.name)}-${job.gameId.slice(0, 6)}`));
    job.folder = destination;
    const present = await fs.stat(destination).catch(() => null);
    if (present) {
      const manifest = JSON.parse(await fs.readFile(path.join(destination, '.mamba-game.json'), 'utf8').catch(() => '{}'));
      if (manifest.releaseId !== job.gameId) throw new Error('The destination already exists. Existing files were preserved.');
      if (manifest.status === 'installed') { await this.update(job, { status: 'completed', progress: 100, message: 'Installed', folder: destination }); await this.library.scan(); return; }
    }
    if (!job.remote) {
      await this.update(job, { status: 'preparing', message: 'Adding release to TorBox' });
      job.remote = await api.create(job.uri, config.cachedOnly, signal); await this.persist();
    }
    let info;
    const deadline = Date.now() + config.transferTimeoutMinutes * 60000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      info = await api.info(job.remote.kind, job.remote.id, signal);
      if (info?.download_finished && Array.isArray(info.files) && info.files.length) break;
      if (info?.download_present && info?.progress >= 1 && info?.files?.length) break;
      if (/failed|error|deleted/i.test(info?.download_state || '')) throw new Error('TorBox could not prepare this release.');
      await this.update(job, { status: 'preparing', message: `TorBox: ${info?.download_state || 'preparing files'}`, progress: Math.round(Number(info?.progress || 0) * 100) });
      await delay(5000, signal);
    }
    if (!info?.files?.length || !(info.download_finished || (info.download_present && info.progress >= 1))) throw new Error('TorBox preparation timed out. Retry to check again.');
    const files = info.files.filter((file) => file.id !== undefined && Number(file.size) >= 0);
    const total = files.reduce((sum, file) => sum + Number(file.size || 0), 0); let previous = 0;
    const seen = new Set();
    for (const file of files) {
      signal.throwIfAborted();
      const relative = String(file.name || file.short_name || `file-${file.id}`).replaceAll('\\', '/');
      if (relative.startsWith('/') || relative.includes(':') || relative.split('/').includes('..') || !relative.trim()) throw new Error('TorBox returned an unsafe file path.');
      const target = within(raw, path.join(raw, relative));
      if (seen.has(target.toLowerCase())) throw new Error('TorBox returned colliding filenames.');
      seen.add(target.toLowerCase());
      const link = await api.downloadLink(job.remote.kind, job.remote.id, file.id, signal);
      await this.update(job, { status: 'downloading', message: `Downloading ${path.basename(relative)}`, total });
      await downloadFile(link, target, Number(file.size || 0), signal, (received) => {
        this.update(job, { received: previous + received, total, progress: total ? Math.min(100, Math.round((previous + received) / total * 100)) : 0 }, true).catch(() => {});
      }, this.fetch);
      previous += Number(file.size || 0);
    }
    await this.update(job, { status: 'extracting', message: 'Extracting and removing wrapper folders', progress: 100 });
    if (!present) {
      // Retrying extraction uses a fresh owned staging folder; never deletes user folders.
      const existingPayload = await fs.stat(payload).catch(() => null);
      if (existingPayload) await fs.rename(payload, path.join(stage, 'previous-' + Date.now()));
      const found = await unpack(raw, payload, { signal, password: config.archivePassword || '' }, (message) => { this.update(job, { message }, true).catch(() => {}); });
      signal.throwIfAborted();
      await fs.rename(payload, destination);
      job.hasInstaller = Boolean(found.installer);
    }
    let found = await detect(destination);
    let status = found.installer ? 'needs-setup' : found.executable ? 'installed' : 'needs-setup';
    await atomicJson(path.join(destination, '.mamba-game.json'), { name: job.name, releaseId: job.gameId, status, installedAt: new Date().toISOString(), executable: found.executable });
    if (found.installer && config.autoInstall) {
      await this.update(job, { status: 'installing', message: 'Running supported installer' });
      const installTarget = destination;
      const installed = await autoInstall(found.installer, installTarget, signal);
      if (installed) {
        found = await detect(installTarget);
        if (!found.executable) throw new Error('Setup finished but no game executable was found. Open the game folder to finish setup.');
        status = 'installed';
      }
    }
    await atomicJson(path.join(destination, '.mamba-game.json'), { name: job.name, releaseId: job.gameId, status, installedAt: new Date().toISOString(), executable: found.executable });
    if (!config.keepArchives) {
      const stagingRoot = within(job.root, path.join(job.root, '.mamba-downloads'));
      within(stagingRoot, stage);
      if (/^[a-f0-9-]{36}$/i.test(path.basename(stage))) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    }
    await this.library.scan();
    await this.update(job, { status: status === 'installed' ? 'completed' : 'needs-setup', message: status === 'installed' ? 'Ready to play' : 'Files ready. This installer needs manual setup.', progress: 100, folder: destination });
  }
  stop() { for (const controller of this.controllers.values()) controller.abort(); }
}
module.exports = { Downloads, downloadFile };
