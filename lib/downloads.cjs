const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { TorBox, delay } = require('./torbox.cjs');
const { displayTitle, optionTraits } = require('./search.cjs');
const {ensureSpace,sizeBytes}=require('./experience.cjs');
const {explain}=require('./issues.cjs');
const { within, safeName, unpack, autoInstall, detect, finalizeInstallation, atomicJson } = require('./library.cjs');

class RollingSpeed {
  constructor(now = () => performance.now()) {
    this.now = now; this.started = now(); this.bytes = 0;
    this.samples = [{ at: this.started, bytes: 0 }];
  }
  add(bytes = 0) {
    const at = this.now(); this.bytes += bytes;
    const cutoff = Math.max(this.started, at - 20000);
    while (this.samples.length > 1 && this.samples[1].at <= cutoff) this.samples.shift();
    const left = this.samples[0], right = this.samples[1] || { at, bytes: this.bytes };
    const fraction = right.at > left.at ? (cutoff - left.at) / (right.at - left.at) : 0;
    const baseline = left.bytes + (right.bytes - left.bytes) * fraction;
    if (at - this.samples[this.samples.length - 1].at >= 250) this.samples.push({ at, bytes: this.bytes });
    return at - cutoff >= 300 ? Math.max(0, (this.bytes - baseline) * 1000 / (at - cutoff)) : 0;
  }
}

async function downloadFile(url, destination, expected, signal, onProgress, transport = fetch, meter = new RollingSpeed()) {
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
  onProgress(bytes, total, 0);
  const progress = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    onProgress(bytes, total, meter.add(chunk.length)); callback(null, chunk);
  } });
  const ticker = setInterval(() => onProgress(bytes, total, meter.add()), 1000);
  try { await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: start ? 'a' : 'w' }), { signal }); }
  finally { clearInterval(ticker); }
  if (total > 0 && bytes !== total) throw new Error('Download was incomplete. Retry to resume it.');
  await fs.rename(partial, destination);
}

class Downloads extends EventEmitter {
  constructor(directory, getConfig, catalog, library, { transport = fetch, apiFactory = (key) => new TorBox(key, transport), resolveName = async name => name, registerGame = async () => null, registerXbox = async () => null, setupGame, checkDisk = ensureSpace, reviewSetup = async () => {} } = {}) {
    super(); this.file = path.join(directory, 'downloads.json'); this.getConfig = getConfig; this.catalog = catalog; this.library = library;
    this.fetch = transport; this.apiFactory = apiFactory; this.jobs = []; this.running = false; this.controllers = new Map(); this.persistQueue = Promise.resolve(); this.lastProgress = 0;
    this.bestPending = new Map();
    this.resolveName = resolveName; this.registerGame = registerGame;
    this.registerXbox = registerXbox;
    this.checkDisk=checkDisk; this.pauseRequests=new Set(); this.setupGame = setupGame; this.reviewSetup = reviewSetup;
  }
  snapshot() { return this.jobs.map(({ uri, ...job }) => job); }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if(!Array.isArray(saved))throw new SyntaxError('The saved queue must be a list.');
      this.jobs = Array.isArray(saved) ? saved.filter((job) => /^[a-f0-9-]{36}$/i.test(job.id)).map((job) => ['completed', 'cancelled', 'failed', 'needs-setup', 'paused'].includes(job.status) ? job : { ...job, status: 'paused', message: 'Interrupted. Retry to resume.' }) : [];
    } catch (error) {
      if(error.code!=='ENOENT'){
        if(!(error instanceof SyntaxError))throw error;
        await fs.copyFile(this.file,this.file+'.backup-'+Date.now());this.jobs=[];
        await this.persist();
        this.loadWarning='The download queue was unreadable. A backup was kept; add the affected downloads again. Your installed games were not removed.';
      }
    }
  }
  persist() {
    this.persistQueue = this.persistQueue.catch(() => {}).then(() => atomicJson(this.file, this.jobs));
    return this.persistQueue;
  }
  async update(job, patch, progressOnly = false) {
    if (!this.jobs.includes(job)) return;
    if (patch.status && patch.status !== 'downloading') patch.speed = 0;
    if(['preparing','downloading','extracting','installing','completed'].includes(patch.status))patch.stage=patch.status;
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
    if (existing && (!['completed','needs-setup'].includes(existing.status) || existing.folder && await fs.stat(existing.folder).catch(()=>null))) return existing.id;
    const indexed = this.catalog.searchIndex?.find(entry => entry.options.some(option => option.gameId === game.id));
    await this.checkDisk(config.downloadPath,sizeBytes(game.fileSize),{probe:true});
    const job = { version:optionTraits({release:game.name}).version || null, release:game.name, id: randomUUID(), gameId: game.id, name: displayName || indexed?.name || displayTitle(game.name), uri: link.uri, status: 'queued', message: 'Waiting to download', progress: 0, received: 0, total: 0, createdAt: new Date().toISOString(), root: path.resolve(config.downloadPath) };
    this.jobs.unshift(job); await this.persist(); this.emit('change', this.snapshot()); this.pump().catch(error=>this.emit('failure',error)); return job.id;
  }
  async pause(id) {
    const job=this.jobs.find(item=>item.id===id);
    if(!job||!['queued','preparing','downloading'].includes(job.status))throw Error('This stage cannot be paused safely. Wait for extraction or setup to finish.');
    this.pauseRequests.add(id);this.controllers.get(id)?.abort();
    await this.update(job,{status:'paused',message:'Paused. Partial files are kept; resume when ready.'});
  }
  async cancel(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || ['completed', 'needs-setup', 'cancelled'].includes(job.status)) return;
    this.pauseRequests.delete(id);this.controllers.get(id)?.abort();
    await this.update(job, { status: 'cancelled', message: 'Cancelled. Partial files kept for retry.' });
  }
  async retry(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !['paused', 'failed', 'cancelled'].includes(job.status)) throw new Error('This download cannot be retried yet.');
    for (let i = 0; this.controllers.has(id) && i < 50; i++) await delay(100);
    if (this.controllers.has(id)) throw new Error('Cancellation is still finishing. Try again in a moment.');
    this.pauseRequests.delete(id);
    await this.update(job, { status: 'queued', error:null, message: 'Queued to resume' }); this.pump().catch(error=>this.emit('failure',error));
  }
  async remove(id) {
    this.controllers.get(id)?.abort();
    this.jobs = this.jobs.filter((job) => job.id !== id);
    await this.persist(); this.emit('change', this.snapshot());
  }
  async clearFinished() {
    this.jobs = this.jobs.filter((job) => !['completed', 'needs-setup', 'cancelled', 'failed'].includes(job.status));
    await this.persist(); this.emit('change', this.snapshot());
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
          const paused=this.pauseRequests.has(job.id);
          await this.update(job, { status: controller.signal.aborted ? paused ? 'paused' : 'cancelled' : 'failed', error:controller.signal.aborted?null:explain(error), message: controller.signal.aborted ? paused ? 'Paused. Resume to continue.' : 'Cancelled. Partial files kept for retry.' : error.message.slice(0, 400) });
        } finally { this.controllers.delete(job.id); this.pauseRequests.delete(job.id); }
      }
    } finally { this.running = false; }
  }
  async execute(job, signal) {
    const config = await this.getConfig();
    const api = this.apiFactory(config.torboxApiKey);
    const stage = within(job.root, path.join(job.root, '.mamba-downloads', job.id));
    const raw = path.join(stage, 'raw'); const payload = path.join(stage, 'payload');
    await fs.mkdir(raw, { recursive: true });
    let destination = job.folder ? within(job.root, job.folder) : within(job.root, path.join(job.root, `${safeName(job.name)}-${job.gameId.slice(0, 6)}`));
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
    let existingBytes=0;
    for(const file of await require('./library.cjs').walk(raw))existingBytes+=(await fs.stat(file)).size;
    job.storage=await this.checkDisk(job.root,total,{existing:existingBytes});
    const meter = new RollingSpeed();
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
      await downloadFile(link, target, Number(file.size || 0), signal, (received, _total, speed) => {
        this.update(job, { received: previous + received, total, speed, progress: total ? Math.min(100, Math.round((previous + received) / total * 100)) : 0 }, true).catch(() => {});
      }, this.fetch, meter);
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
    await require('./game-helper.cjs').installGameHelper(destination);
    let found = await detect(destination);
    let status = found.installer ? 'needs-setup' : found.executable ? 'installed' : 'needs-setup';
    await atomicJson(path.join(destination, '.mamba-game.json'), { name: job.name, version:job.version, release:job.release, releaseId: job.gameId, status, installedAt: new Date().toISOString(), executable: found.executable });
    if (found.installer && config.autoInstall) {
      await this.update(job, { status: 'installing', message: 'Running supported installer' });
      const installTarget = destination;
      const installed = await autoInstall(found.installer, installTarget, signal);
      if (installed) {
        found = await detect(installTarget);
        status = found.executable ? 'installed' : 'needs-setup';
      }
    }
    let steamRegistration;
    if (status === 'installed') {
      job.name = await this.resolveName(job.name);
      const repairManifest = JSON.parse(await fs.readFile(path.join(destination, '.mamba-game.json'), 'utf8'));
      await atomicJson(path.join(destination, '.mamba-game.json'), { ...repairManifest, repairPending: true });
      let finalized;
      try { finalized = await finalizeInstallation(destination, job.name, { releaseId: job.gameId, status }); }
      catch (error) { await this.reviewSetup(destination); throw error; }
      destination = finalized.folder; found = finalized; job.folder = destination;
      if (this.setupGame) {
        try {
          const result = await this.setupGame({ name: job.name, file: found.executable, folder: destination });
          destination = result.folder; found.executable = result.executable; job.folder = destination; steamRegistration = result.steam;
        } catch (error) {
          await this.reviewSetup(destination);
          throw new Error('Automatic shortcut setup needs review: '+error.message);
        }
      } else {
        const xbox = await this.registerXbox({ name: job.name, executable: found.executable, folder: destination }).catch(error => ({ status: 'pending', message: error.message }));
        if (xbox) finalized.manifest.xbox = xbox;
        const steam = await this.registerGame({ name: job.name, executable: found.executable, folder: destination }).catch(error => ({ status: 'pending', message: error.message }));
        steamRegistration = steam;
        if (steam) await atomicJson(path.join(destination, '.mamba-game.json'), { ...finalized.manifest, steam });
      }
    } else {
      await atomicJson(path.join(destination, '.mamba-game.json'), { name: job.name, releaseId: job.gameId, status, installedAt: new Date().toISOString(), executable: found.executable });
      await this.reviewSetup(destination);
    }
    if (!config.keepArchives) {
      const stagingRoot = within(job.root, path.join(job.root, '.mamba-downloads'));
      within(stagingRoot, stage);
      if (/^[a-f0-9-]{36}$/i.test(path.basename(stage))) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    }
    await this.library.scan();
    await this.update(job, { status: status === 'installed' ? 'completed' : 'needs-setup', message: status === 'installed' ? 'Ready to play' + (steamRegistration?.status === 'pending' ? ` · Steam: ${steamRegistration.message}` : '') : 'Files ready. Use ADD-GAME.cmd to select a launcher if needed.', progress: 100, folder: destination });
  }
  stop() { for (const controller of this.controllers.values()) controller.abort(); }
}
module.exports = { Downloads, downloadFile, RollingSpeed };
