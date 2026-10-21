const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { TorBox, delay } = require('./torbox.cjs');
const { displayTitle, optionTraits } = require('./search.cjs');
const { ensureSpace, sizeBytes } = require('./experience.cjs');
const { explain } = require('./issues.cjs');
const {
  chooseService,
  createService,
  enabledServices,
  hostAllowed,
} = require('./download-services.cjs');
const {
  within,
  safeName,
  unpack,
  autoInstall,
  detect,
  finalizeInstallation,
  atomicJson,
} = require('./library.cjs');

class RollingSpeed {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.started = now();
    this.bytes = 0;
    this.samples = [{ at: this.started, bytes: 0 }];
  }
  add(bytes = 0) {
    const at = this.now();
    this.bytes += bytes;
    const cutoff = Math.max(this.started, at - 20000);
    while (this.samples.length > 1 && this.samples[1].at <= cutoff) this.samples.shift();
    const left = this.samples[0],
      right = this.samples[1] || { at, bytes: this.bytes };
    const fraction = right.at > left.at ? (cutoff - left.at) / (right.at - left.at) : 0;
    const baseline = left.bytes + (right.bytes - left.bytes) * fraction;
    if (at - this.samples[this.samples.length - 1].at >= 250)
      this.samples.push({ at, bytes: this.bytes });
    return at - cutoff >= 300 ? Math.max(0, ((this.bytes - baseline) * 1000) / (at - cutoff)) : 0;
  }
}

async function downloadFile(
  url,
  destination,
  expected,
  signal,
  onProgress,
  transport = fetch,
  meter = new RollingSpeed(),
) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await downloadAttempt(
        url,
        destination,
        expected,
        signal,
        onProgress,
        transport,
        meter,
      );
    } catch (cause) {
      if (signal?.aborted) throw cause;
      const received = await fs
        .stat(destination + '.part')
        .then((stat) => stat.size)
        .catch(() => 0);
      const error = new Error(
        `Download failed: ${cause.message}. Saved ${received} of ${expected || 'unknown'} bytes; partial files kept.`,
        { cause },
      );
      error.code = cause.code || 'DOWNLOAD_FAILED';
      error.download = {
        received,
        expected,
        attempt: attempt + 1,
        causeCode: cause.cause?.code || cause.code || null,
      };
      const transient =
        cause.retryable ||
        /terminated|fetch failed|ECONN|ETIMEDOUT|UND_ERR_/i.test(
          `${cause.message} ${cause.code} ${cause.cause?.code}`,
        );
      if (!transient || attempt >= 2) throw error;
      await delay(250 * (attempt + 1), signal);
    }
  }
}

async function downloadAttempt(url, destination, expected, signal, onProgress, transport, meter) {
  const partial = destination + '.part';
  await fs.mkdir(path.dirname(destination), { recursive: true });
  let start = await fs
    .stat(partial)
    .then((stat) => stat.size)
    .catch(() => 0);
  const finished = await fs.stat(destination).catch(() => null);
  if (finished && expected > 0 && finished.size === expected) {
    onProgress(finished.size, expected);
    return;
  }
  if (expected > 0 && start === expected) {
    await fs.rename(partial, destination);
    onProgress(start, expected);
    return;
  }
  const response = await transport(url, {
    signal,
    headers: { 'Accept-Encoding': 'identity', ...(start ? { Range: `bytes=${start}-` } : {}) },
  });
  const rejectResponse = async (message) => {
    await response.body?.cancel().catch(() => {});
    throw new Error(message);
  };
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`File download failed (${response.status})`), {
      retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
    });
  }
  if (/text\/html|application\/(?:json|xhtml)/i.test(response.headers.get('content-type') || ''))
    return rejectResponse('Download service returned a webpage instead of a file');
  if (start && response.status !== 206)
    return rejectResponse('Server ignored download resume; existing partial file preserved');
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
  const lengthHeader = response.headers.get('content-length');
  const length = lengthHeader === null ? null : Number(lengthHeader);
  if (
    response.headers.get('content-encoding') &&
    response.headers.get('content-encoding') !== 'identity'
  )
    return rejectResponse('Encoded download cannot be safely resumed');
  if (length !== null && (!Number.isSafeInteger(length) || length < 0))
    return rejectResponse('Invalid download response length');
  if (range && range.slice(1).some((value) => !Number.isSafeInteger(Number(value))))
    return rejectResponse('Invalid download resume response');
  if (
    response.status === 206 &&
    (!range ||
      Number(range[1]) !== start ||
      Number(range[2]) < start ||
      Number(range[2]) >= Number(range[3]) ||
      (expected > 0 && Number(range[3]) !== expected) ||
      (length !== null && length !== Number(range[2]) - start + 1))
  )
    return rejectResponse('Invalid download resume response');
  const total = expected || (range ? Number(range[3]) : length === null ? 0 : length);
  if (expected > 0 && start > expected)
    return rejectResponse('Partial download exceeds expected size');
  if (response.status !== 206 && expected > 0 && length !== null && length !== expected)
    return rejectResponse('Download response size disagrees with expected size');
  let bytes = start;
  onProgress(bytes, total, 0);
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      if (total > 0 && bytes + chunk.length > total)
        return callback(new Error('Download response exceeds expected size'));
      bytes += chunk.length;
      onProgress(bytes, total, meter.add(chunk.length));
      callback(null, chunk);
    },
  });
  const ticker = setInterval(() => onProgress(bytes, total, meter.add()), 1000);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      progress,
      createWriteStream(partial, { flags: start ? 'a' : 'w' }),
      { signal },
    );
  } finally {
    clearInterval(ticker);
  }
  if (total > 0 && bytes !== total)
    throw Object.assign(new Error('Download was incomplete; retry to resume it'), {
      code: 'DOWNLOAD_INCOMPLETE',
      retryable: true,
    });
  signal?.throwIfAborted();
  await fs.rename(partial, destination);
}

class Downloads extends EventEmitter {
  constructor(
    directory,
    getConfig,
    catalog,
    library,
    {
      transport = fetch,
      apiFactory = (key) => new TorBox(key, transport),
      resolveName = async (name) => name,
      registerGame = async () => null,
      registerXbox = async () => null,
      setupGame,
      checkDisk = ensureSpace,
      reviewSetup = async () => {},
    } = {},
  ) {
    super();
    this.file = path.join(directory, 'downloads.json');
    this.getConfig = getConfig;
    this.catalog = catalog;
    this.library = library;
    this.fetch = transport;
    this.apiFactory = apiFactory;
    this.jobs = [];
    this.running = false;
    this.controllers = new Map();
    this.persistQueue = Promise.resolve();
    this.lastProgress = 0;
    this.bestPending = new Map();
    this.resolveName = resolveName;
    this.registerGame = registerGame;
    this.registerXbox = registerXbox;
    this.checkDisk = checkDisk;
    this.pauseRequests = new Set();
    this.setupGame = setupGame;
    this.reviewSetup = reviewSetup;
  }
  snapshot() {
    return this.jobs.map(({ uri, ...job }) => job);
  }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!Array.isArray(saved)) throw new SyntaxError('The saved queue must be a list.');
      this.jobs = Array.isArray(saved)
        ? saved
            .filter((job) => /^[a-f0-9-]{36}$/i.test(job.id))
            .map((job) =>
              ['completed', 'cancelled', 'failed', 'needs-setup', 'paused'].includes(job.status)
                ? job
                : { ...job, status: 'paused', message: 'Interrupted. Retry to resume.' },
            )
        : [];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (!(error instanceof SyntaxError)) throw error;
        await fs.copyFile(this.file, this.file + '.backup-' + Date.now());
        this.jobs = [];
        await this.persist();
        this.loadWarning =
          'The download queue was unreadable. A backup was kept; add the affected downloads again. Your installed games were not removed.';
      }
    }
  }
  persist() {
    this.persistQueue = this.persistQueue
      .catch(() => {})
      .then(() => atomicJson(this.file, this.jobs));
    return this.persistQueue;
  }
  async clearStalePartials(now = Date.now()) {
    const cutoff = now - 24 * 60 * 60 * 1000;
    for (const job of this.jobs) {
      if (
        !['paused', 'failed', 'cancelled'].includes(job.status) ||
        this.controllers.has(job.id) ||
        !/^[a-f0-9-]{36}$/i.test(job.id) ||
        !path.isAbsolute(job.root || '')
      )
        continue;
      try {
        const root = await fs.realpath(job.root);
        const stagingRoot = path.join(root, '.mamba-downloads');
        const stage = within(stagingRoot, path.join(stagingRoot, job.id));

        if (
          (await fs.lstat(stagingRoot)).isSymbolicLink() ||
          (await fs.realpath(stagingRoot)) !== stagingRoot ||
          (await fs.realpath(stage)) !== stage
        )
          continue;
        async function newest(folder) {
          const stat = await fs.lstat(folder);
          if (stat.isSymbolicLink()) return Infinity;
          let touched = stat.mtimeMs;
          if (stat.isDirectory())
            for (const name of await fs.readdir(folder))
              touched = Math.max(touched, await newest(path.join(folder, name)));
          return touched;
        }
        if ((await newest(stage)) >= cutoff) continue;

        await fs.rm(stage, { recursive: true });
        await this.update(job, {
          status: 'cancelled',
          received: 0,
          progress: 0,
          error: null,
          downloadFailure: null,
          message:
            'Unfinished files cleared after 24 hours without changes. Retry to download again.',
        });
      } catch (error) {
        if (error.code !== 'ENOENT')
          this.emit(
            'failure',
            new Error(`Could not clear stale partial download: ${error.code || 'cleanup failed'}`),
          );
      }
    }
  }
  async update(job, patch, progressOnly = false) {
    if (!this.jobs.includes(job)) return;
    if (patch.status && patch.status !== 'downloading') patch.speed = 0;
    if (
      ['preparing', 'downloading', 'extracting', 'installing', 'completed'].includes(patch.status)
    )
      patch.stage = patch.status;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    if (progressOnly && Date.now() - this.lastProgress < 300) return;
    this.lastProgress = Date.now();
    this.emit('change', this.snapshot());
    if (!progressOnly) await this.persist();
  }
  startBest(id) {
    if (this.bestPending.has(id)) return this.bestPending.get(id);
    const task = this.catalog.resolveGame(id).then((game) => {
      if (!game.best)
        throw new Error(game.message || 'No compatible download is currently available.');
      return this.start(game.best.gameId, game.best.linkIndex, game.name);
    });
    this.bestPending.set(id, task);
    task.finally(() => this.bestPending.delete(id)).catch(() => {});
    return task;
  }
  async start(gameId, option = 0, displayName, requestedService) {
    const game = this.catalog.byId.get(gameId);
    if (!game) throw new Error('This release is no longer in the catalog. Search again.');
    const link = game.links[Number(option)];
    if (!link) throw new Error('Choose a download option.');
    const config = await this.getConfig();
    const service = chooseService(link, config, requestedService);
    const existing = this.jobs.find(
      (job) => job.gameId === game.id && !['failed', 'cancelled'].includes(job.status),
    );
    if (
      existing &&
      (!['completed', 'needs-setup'].includes(existing.status) ||
        (existing.folder && (await fs.stat(existing.folder).catch(() => null))))
    )
      return existing.id;
    const indexed = this.catalog.searchIndex?.find((entry) =>
      entry.options.some((option) => option.gameId === game.id),
    );
    await this.checkDisk(config.downloadPath, sizeBytes(game.fileSize), { probe: true });
    const job = {
      version: optionTraits({ release: game.name }).version || null,
      release: game.name,
      id: randomUUID(),
      gameId: game.id,
      name: displayName || indexed?.name || displayTitle(game.name),
      uri: link.uri,
      status: 'queued',
      message: 'Waiting to download',
      progress: 0,
      received: 0,
      total: 0,
      createdAt: new Date().toISOString(),
      root: path.resolve(config.downloadPath),
    };
    job.service = service;
    this.jobs.unshift(job);
    await this.persist();
    this.emit('change', this.snapshot());
    this.pump().catch((error) => this.emit('failure', error));
    return job.id;
  }
  async pause(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || !['queued', 'preparing', 'downloading'].includes(job.status))
      throw Error('This stage cannot be paused safely. Wait for extraction or setup to finish.');
    this.pauseRequests.add(id);
    this.controllers.get(id)?.abort();
    await this.update(job, {
      status: 'paused',
      message: 'Paused. Partial files are kept; resume when ready.',
    });
  }
  async cancel(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || ['completed', 'needs-setup', 'cancelled'].includes(job.status)) return;
    this.pauseRequests.delete(id);
    this.controllers.get(id)?.abort();
    await this.update(job, {
      status: 'cancelled',
      message: 'Cancelled. Partial files kept for retry.',
    });
  }
  async retry(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !['paused', 'failed', 'cancelled'].includes(job.status))
      throw new Error('This download cannot be retried yet.');
    for (let i = 0; this.controllers.has(id) && i < 50; i++) await delay(100);
    if (this.controllers.has(id))
      throw new Error('Cancellation is still finishing. Try again in a moment.');
    this.pauseRequests.delete(id);
    await this.update(job, {
      status: 'queued',
      error: null,
      downloadFailure: null,
      message: 'Queued to resume',
    });
    this.pump().catch((error) => this.emit('failure', error));
  }
  async remove(id) {
    this.controllers.get(id)?.abort();
    this.jobs = this.jobs.filter((job) => job.id !== id);
    await this.persist();
    this.emit('change', this.snapshot());
  }
  async clearFinished() {
    this.jobs = this.jobs.filter(
      (job) => !['completed', 'needs-setup', 'cancelled', 'failed'].includes(job.status),
    );
    await this.persist();
    this.emit('change', this.snapshot());
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      let job;
      while ((job = this.jobs.find((entry) => entry.status === 'queued'))) {
        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        try {
          await this.execute(job, controller.signal);
        } catch (error) {
          const paused = this.pauseRequests.has(job.id);
          await this.update(job, {
            status: controller.signal.aborted ? (paused ? 'paused' : 'cancelled') : 'failed',
            ...(error.download
              ? {
                  received: (job.downloadOffset || 0) + error.download.received,
                  downloadFailure: error.download,
                }
              : {}),
            error: controller.signal.aborted ? null : explain(error),
            message: controller.signal.aborted
              ? paused
                ? 'Paused. Resume to continue.'
                : 'Cancelled. Partial files kept for retry.'
              : error.message.slice(0, 400),
          });
        } finally {
          this.controllers.delete(job.id);
          this.pauseRequests.delete(job.id);
        }
      }
    } finally {
      this.running = false;
    }
  }
  async execute(job, signal) {
    const config = await this.getConfig();
    const service = job.service || 'torbox';
    const api =
      service === 'torbox'
        ? this.apiFactory(config.torboxApiKey)
        : createService(service, config, this.fetch, job.uri);
    const serviceName = { torbox: 'TorBox', realdebrid: 'Real-Debrid', direct: 'Direct download' }[
      service
    ];
    if (!enabledServices(config).includes(service) || !hostAllowed(job.uri, config))
      throw Error(serviceName + ' or this download host is disabled in Settings.');
    const stage = within(job.root, path.join(job.root, '.mamba-downloads', job.id));
    const raw = path.join(stage, 'raw');
    const payload = path.join(stage, 'payload');
    await fs.mkdir(raw, { recursive: true });
    let destination = job.folder
      ? within(job.root, job.folder)
      : within(job.root, path.join(job.root, `${safeName(job.name)}-${job.gameId.slice(0, 6)}`));
    job.folder = destination;
    const present = await fs.stat(destination).catch(() => null);
    if (present) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(destination, '.mamba-game.json'), 'utf8').catch(() => '{}'),
      );
      if (manifest.releaseId !== job.gameId)
        throw new Error('The destination already exists. Existing files were preserved.');
      if (manifest.status === 'installed') {
        await this.update(job, {
          status: 'completed',
          progress: 100,
          message: 'Installed',
          folder: destination,
        });
        await this.library.scan();
        return;
      }
    }
    if (!job.remote) {
      await this.update(job, { status: 'preparing', message: 'Preparing with ' + serviceName });
      job.remote = await api.create(job.uri, config.cachedOnly, signal);
      await this.persist();
    }
    let info;
    const deadline = Date.now() + config.transferTimeoutMinutes * 60000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      info = await api.info(job.remote.kind, job.remote.id, signal);
      if (info?.download_finished && Array.isArray(info.files) && info.files.length) break;
      if (info?.download_present && info?.progress >= 1 && info?.files?.length) break;
      if (/failed|error|deleted/i.test(info?.download_state || ''))
        throw new Error(serviceName + ' could not prepare this release.');
      await this.update(job, {
        status: 'preparing',
        message: `${serviceName}: ${info?.download_state || 'preparing files'}`,
        progress: Math.round(Number(info?.progress || 0) * 100),
      });
      await delay(5000, signal);
    }
    if (
      !info?.files?.length ||
      !(info.download_finished || (info.download_present && info.progress >= 1))
    )
      throw new Error(serviceName + ' preparation timed out. Retry to check again.');
    const files = info.files.filter((file) => file.id !== undefined && Number(file.size) >= 0);
    const total = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    let previous = 0;
    let existingBytes = 0;
    for (const file of await require('./library.cjs').walk(raw))
      existingBytes += (await fs.stat(file)).size;
    job.storage = await this.checkDisk(job.root, total, { existing: existingBytes });
    const meter = new RollingSpeed();
    const seen = new Set();
    for (const file of files) {
      signal.throwIfAborted();
      const relative = String(file.name || file.short_name || `file-${file.id}`).replaceAll(
        '\\',
        '/',
      );
      if (
        relative.startsWith('/') ||
        relative.includes(':') ||
        relative.split('/').includes('..') ||
        !relative.trim()
      )
        throw new Error('TorBox returned an unsafe file path.');
      const target = within(raw, path.join(raw, relative));
      if (seen.has(target.toLowerCase())) throw new Error('TorBox returned colliding filenames.');
      seen.add(target.toLowerCase());
      const link = await api.downloadLink(job.remote.kind, job.remote.id, file.id, signal);
      job.downloadOffset = previous;
      await this.update(job, {
        status: 'downloading',
        message: `Downloading ${path.basename(relative)}`,
        total,
      });
      await downloadFile(
        link,
        target,
        Number(file.size || 0),
        signal,
        (received, _total, speed) => {
          this.update(
            job,
            {
              received: previous + received,
              total,
              speed,
              progress: total ? Math.min(99, Math.floor(((previous + received) / total) * 100)) : 0,
            },
            true,
          ).catch(() => {});
        },
        this.fetch,
        meter,
      );
      previous += Number(file.size || 0);
    }
    await this.update(job, {
      status: 'extracting',
      message: 'Extracting and removing wrapper folders',
      progress: 100,
    });
    if (!present) {
      const existingPayload = await fs.stat(payload).catch(() => null);
      if (existingPayload) await fs.rename(payload, path.join(stage, 'previous-' + Date.now()));
      const found = await unpack(
        raw,
        payload,
        { signal, password: config.archivePassword || '' },
        (message) => {
          this.update(job, { message }, true).catch(() => {});
        },
      );
      signal.throwIfAborted();
      await fs.rename(payload, destination);
      job.hasInstaller = Boolean(found.installer);
    }
    await require('./game-helper.cjs').installGameHelper(destination);
    let found = await detect(destination);
    let status = found.installer ? 'needs-setup' : found.executable ? 'installed' : 'needs-setup';
    await atomicJson(path.join(destination, '.mamba-game.json'), {
      name: job.name,
      version: job.version,
      release: job.release,
      releaseId: job.gameId,
      status,
      installedAt: new Date().toISOString(),
      executable: found.executable,
    });
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
      const repairManifest = JSON.parse(
        await fs.readFile(path.join(destination, '.mamba-game.json'), 'utf8'),
      );
      await atomicJson(path.join(destination, '.mamba-game.json'), {
        ...repairManifest,
        repairPending: true,
      });
      let finalized;
      try {
        finalized = await finalizeInstallation(destination, job.name, {
          releaseId: job.gameId,
          status,
        });
      } catch (error) {
        await this.reviewSetup(destination);
        throw error;
      }
      destination = finalized.folder;
      found = finalized;
      job.folder = destination;
      if (this.setupGame) {
        try {
          const result = await this.setupGame({
            name: job.name,
            file: found.executable,
            folder: destination,
          });
          destination = result.folder;
          found.executable = result.executable;
          job.folder = destination;
          steamRegistration = result.steam;
        } catch (error) {
          await this.reviewSetup(destination);
          throw new Error('Automatic shortcut setup needs review: ' + error.message);
        }
      } else {
        const xbox = await this.registerXbox({
          name: job.name,
          executable: found.executable,
          folder: destination,
        }).catch((error) => ({ status: 'pending', message: error.message }));
        if (xbox) finalized.manifest.xbox = xbox;
        const steam = await this.registerGame({
          name: job.name,
          executable: found.executable,
          folder: destination,
        }).catch((error) => ({ status: 'pending', message: error.message }));
        steamRegistration = steam;
        if (steam)
          await atomicJson(path.join(destination, '.mamba-game.json'), {
            ...finalized.manifest,
            steam,
          });
      }
    } else {
      await atomicJson(path.join(destination, '.mamba-game.json'), {
        name: job.name,
        releaseId: job.gameId,
        status,
        installedAt: new Date().toISOString(),
        executable: found.executable,
      });
      await this.reviewSetup(destination);
    }
    if (!config.keepArchives) {
      const stagingRoot = within(job.root, path.join(job.root, '.mamba-downloads'));
      within(stagingRoot, stage);
      if (/^[a-f0-9-]{36}$/i.test(path.basename(stage)))
        await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    }
    await this.library.scan();
    await this.update(job, {
      status: status === 'installed' ? 'completed' : 'needs-setup',
      message:
        status === 'installed'
          ? 'Ready to play' +
            (steamRegistration?.status === 'pending'
              ? ` · Steam: ${steamRegistration.message}`
              : '')
          : 'Files ready. Use ADD-GAME.cmd to select a launcher if needed.',
      progress: 100,
      folder: destination,
    });
  }
  stop() {
    for (const controller of this.controllers.values()) controller.abort();
  }
}
module.exports = { Downloads, downloadFile, RollingSpeed };
