const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { TorBox, delay } = require('./torbox.cjs');
const { displayTitle, optionTraits } = require('./search.cjs');
const { ensureSpace, sizeBytes } = require('./experience.cjs');
const { explain, safeMessage } = require('./issues.cjs');
const recovery = require('./recovery.cjs');
const { verifyDownloads } = require('./verification.cjs');
const {
  chooseService,
  createService,
  enabledServices,
  hostAllowed,
} = require('./download-services.cjs');
const {
  within,
  safePath,
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
      error.transfer = true;
      error.status = cause.status;
      error.retryAfter = cause.retryAfter;
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
      if (!transient || attempt >= 2 || [429, 401, 403, 404, 410].includes(cause.status))
        throw error;
      await delay(250 * (attempt + 1), signal);
    }
  }
}

async function downloadAttempt(url, destination, expected, signal, onProgress, transport, meter) {
  const partial = destination + '.part';
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await safePath(path.dirname(destination), destination);
  await safePath(path.dirname(destination), partial);
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
  const metadataFile = path.join(
    path.dirname(destination),
    '.mamba-transfer',
    createHash('sha256').update(path.basename(destination)).digest('hex') + '.json',
  );
  await safePath(path.dirname(destination), metadataFile);
  await safePath(path.dirname(destination), metadataFile + '.tmp');
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8').catch(() => '{}'));
  const validator = metadata.etag || metadata.lastModified;
  const transferController = new AbortController();
  const transferSignal = signal
    ? AbortSignal.any([signal, transferController.signal])
    : transferController.signal;
  let idleTimer;
  const heartbeat = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        transferController.abort(
          Object.assign(Error('Download connection timed out'), { code: 'ETIMEDOUT' }),
        ),
      120000,
    );
    idleTimer.unref?.();
  };
  heartbeat();
  let response;
  try {
    response = await transport(url, {
      signal: transferSignal,
      headers: {
        'Accept-Encoding': 'identity',
        ...(start
          ? { Range: `bytes=${start}-`, ...(validator ? { 'If-Range': validator } : {}) }
          : {}),
      },
    });
  } catch (error) {
    clearTimeout(idleTimer);
    throw error;
  }
  const rejectResponse = async (message) => {
    clearTimeout(idleTimer);
    await response.body?.cancel().catch(() => {});
    throw new Error(message);
  };
  if (!response.ok || !response.body) {
    clearTimeout(idleTimer);
    await response.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`File download failed (${response.status})`), {
      status: response.status,
      retryAfter: recovery.retryAfter(response.headers.get('retry-after')),
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
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  if (
    start &&
    ((metadata.etag && etag && metadata.etag !== etag) ||
      (!metadata.etag &&
        metadata.lastModified &&
        lastModified &&
        metadata.lastModified !== lastModified))
  )
    return rejectResponse('Download server returned changed content');
  try {
    await atomicJson(metadataFile, {
      etag: etag && !etag.startsWith('W/') ? etag : null,
      lastModified,
      total,
    });
  } catch (error) {
    clearTimeout(idleTimer);
    await response.body.cancel().catch(() => {});
    throw error;
  }
  let bytes = start;
  onProgress(bytes, total, 0);
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      if (total > 0 && bytes + chunk.length > total)
        return callback(new Error('Download response exceeds expected size'));
      heartbeat();
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
      { signal: transferSignal },
    );
  } catch (error) {
    if (transferController.signal.aborted) throw transferController.signal.reason;
    throw error;
  } finally {
    clearTimeout(idleTimer);
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
      installMetadata = async () => {},
      checkDisk = ensureSpace,
      reviewSetup = async () => {},
      isOnline = recovery.online,
      now = Date.now,
      retryDelay = recovery.backoff,
    } = {},
  ) {
    super();
    this.isOnline = isOnline;
    this.now = now;
    this.retryDelay = retryDelay;
    this.stopped = false;
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
    this.installMetadata = installMetadata;
    this.reviewSetup = reviewSetup;
  }
  snapshot() {
    return this.jobs.map(({ uri, activeFile, recovery: state, ...job }) => ({
      ...job,
      recovery: state
        ? {
            enabled: state.enabled,
            phase: state.phase,
            retryCount: state.retryCount,
            nextRetryAt: state.nextRetryAt,
            history: state.history,
          }
        : undefined,
    }));
  }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!Array.isArray(saved)) throw new SyntaxError('The saved queue must be a list.');
      this.jobs = Array.isArray(saved)
        ? saved
            .filter((job) => /^[a-f0-9-]{36}$/i.test(job.id))
            .map((job) => {
              if (
                ['completed', 'cancelled', 'failed', 'needs-setup', 'paused'].includes(job.status)
              )
                return job;
              if (job.recovery?.installerStarted)
                return {
                  ...job,
                  status: 'needs-setup',
                  message: 'Installer interrupted. Review installation before continuing.',
                };
              if (job.recovery?.enabled && job.pauseReason !== 'manual')
                return {
                  ...job,
                  status: 'waiting-retry',
                  message: 'Recovering interrupted download',
                  recovery: {
                    ...job.recovery,
                    nextRetryAt: job.recovery.nextRetryAt || this.now(),
                  },
                };
              return {
                ...job,
                status: 'paused',
                pauseReason: 'interrupted',
                message: 'Interrupted. Retry to resume.',
              };
            })
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
        !['paused', 'failed', 'cancelled', 'waiting-retry'].includes(job.status) ||
        (job.recovery?.enabled && job.status !== 'cancelled') ||
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
      ['preparing', 'downloading', 'verifying', 'extracting', 'installing', 'completed'].includes(
        patch.status,
      )
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
  async start(gameId, option = 0, displayName, requestedService, installRoot) {
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
    const root = installRoot || config.downloadPath;
    if (!path.isAbsolute(root)) throw Error('Choose an absolute installation folder.');
    await this.checkDisk(root, sizeBytes(game.fileSize), { probe: true });
    const job = {
      version: optionTraits({ release: game.name }).version || null,
      release: game.name,
      id: randomUUID(),
      gameId: game.id,
      installSource: 'hydra',
      name: displayName || indexed?.name || displayTitle(game.name),
      uri: link.uri,
      status: 'queued',
      message: 'Waiting to download',
      progress: 0,
      received: 0,
      total: 0,
      createdAt: new Date().toISOString(),
      root: path.resolve(root),
    };
    job.recovery = recovery.checkpoint(config.automaticRecovery === true);
    job.service = service;
    this.jobs.unshift(job);
    await this.persist();
    this.emit('change', this.snapshot());
    this.pump().catch((error) => this.emit('failure', error));
    return job.id;
  }
  async pause(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || !['queued', 'preparing', 'downloading', 'waiting-retry'].includes(job.status))
      throw Error('This stage cannot be paused safely. Wait for extraction or setup to finish.');
    if (job.recovery) job.recovery.nextRetryAt = null;
    this.pauseRequests.add(id);
    this.controllers.get(id)?.abort();
    await this.update(job, {
      status: 'paused',
      pauseReason: 'manual',
      message: 'Paused. Partial files are kept; resume when ready.',
    });
  }
  async cancel(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || ['completed', 'needs-setup', 'cancelled'].includes(job.status)) return;
    if (job.recovery) job.recovery.nextRetryAt = null;
    this.pauseRequests.delete(id);
    this.controllers.get(id)?.abort();
    await this.update(job, {
      status: 'cancelled',
      pauseReason: 'manual',
      message: 'Cancelled. Partial files kept for retry.',
    });
  }
  async retry(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !['paused', 'failed', 'cancelled', 'waiting-retry'].includes(job.status))
      throw new Error('This download cannot be retried yet.');
    for (let i = 0; this.controllers.has(id) && i < 50; i++) await delay(100);
    if (this.controllers.has(id))
      throw new Error('Cancellation is still finishing. Try again in a moment.');
    this.pauseRequests.delete(id);
    job.recovery ||= recovery.checkpoint();
    job.recovery.enabled = (await this.getConfig()).automaticRecovery === true;
    job.recovery.retryCount = 0;
    job.recovery.nextRetryAt = null;
    await this.update(job, {
      pauseReason: null,
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
  async checkpoint(job, phase, patch = {}) {
    job.recovery ||= recovery.checkpoint();
    Object.assign(job.recovery, { phase }, patch);
    await this.persist();
  }
  schedule() {
    clearTimeout(this.retryTimer);
    if (this.stopped) return;
    const waiting = this.jobs.filter((job) => job.status === 'waiting-retry');
    if (!waiting.length) return;
    const due = Math.min(...waiting.map((job) => job.recovery.nextRetryAt || this.now()));
    this.retryTimer = setTimeout(
      () => this.pump().catch((error) => this.emit('failure', error)),
      Math.min(2147483647, Math.max(10, due - this.now())),
    );
    this.retryTimer.unref?.();
  }
  async recover(job, error) {
    const config = await this.getConfig();
    const state = job.recovery;
    if (
      !state?.enabled ||
      config.automaticRecovery !== true ||
      state.payloadCommitted ||
      state.installerStarted
    )
      return false;
    const policy = recovery.classify(error);
    const secrets = [config.torboxApiKey, config.realDebridApiKey, config.archivePassword];
    if (['attention', 'settings'].includes(policy.action)) return false;
    if (state.retryCount >= recovery.MAX_RETRIES) {
      // Only proven identical torrent content may move to another enabled service.
      const alternatives =
        (await Promise.resolve(this.catalog.recoveryCandidates?.(job, config)).catch(() => [])) ||
        [];
      const next = alternatives.find(
        (candidate) =>
          !(state.triedSources || []).includes(candidate.service + ':' + candidate.uri),
      );
      if (!next || (state.fallbackCount || 0) >= 2) return false;
      state.triedSources = [
        ...new Set([
          ...(state.triedSources || []),
          job.service + ':' + job.uri,
          next.service + ':' + next.uri,
        ]),
      ];
      state.fallbackCount = (state.fallbackCount || 0) + 1;
      state.sameContentFallback = true;
      job.uri = next.uri;
      job.service = next.service;
      job.remote = null;
      state.retryCount = 0;
      recovery.record(job, 'identical-source', 'Switching service for identical content');
    }
    if (['paused', 'cancelled'].includes(job.status) || !this.jobs.includes(job)) return false;
    if (policy.action === 'restart-file') {
      if (!job.activeFile || state.restartedFile === job.activeFile) return false;
      const raw = path.join(job.root, '.mamba-downloads', job.id, 'raw');
      const target = await safePath(job.root, within(raw, job.activeFile));
      await fs.rm(target + '.part', { force: true });
      await fs.rm(
        path.join(
          path.dirname(target),
          '.mamba-transfer',
          createHash('sha256').update(path.basename(target)).digest('hex') + '.json',
        ),
        { force: true },
      );
      state.restartedFile = job.activeFile;
    }
    const connected = await this.isOnline();
    if (['paused', 'cancelled'].includes(job.status) || !this.jobs.includes(job) || this.stopped)
      return false;
    if (connected) state.retryCount++;
    state.nextRetryAt =
      this.now() + (connected ? this.retryDelay(state.retryCount, policy.delay || 0) : 15000);
    recovery.record(job, connected ? policy.action : 'offline', error, secrets);
    await this.update(job, {
      status: 'waiting-retry',
      error: null,
      message: connected
        ? `Connection interrupted. Automatic retry ${state.retryCount} of ${recovery.MAX_RETRIES}. Downloaded files preserved.`
        : 'Waiting for connectivity. Downloaded files preserved.',
    });
    return true;
  }
  async pump() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      let job;
      for (const waiting of this.jobs.filter(
        (job) => job.status === 'waiting-retry' && job.recovery.nextRetryAt <= this.now(),
      )) {
        if ((await this.getConfig()).automaticRecovery !== true) {
          await this.update(waiting, {
            status: 'paused',
            pauseReason: 'recovery-disabled',
            message: 'Automatic recovery disabled. Resume when ready.',
          });
        } else if (await this.isOnline()) {
          if (waiting.status === 'waiting-retry')
            await this.update(waiting, { status: 'queued', message: 'Resuming download' });
        } else waiting.recovery.nextRetryAt = this.now() + 15000;
      }
      await this.persist();
      while (!this.stopped && (job = this.jobs.find((entry) => entry.status === 'queued'))) {
        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        try {
          await this.execute(job, controller.signal);
        } catch (error) {
          if (this.stopped) {
            await this.update(job, {
              message: 'Interrupted. Recovery will continue after restart.',
            });
            continue;
          }
          if (!this.jobs.includes(job)) continue;
          if (!controller.signal.aborted) {
            try {
              if (await this.recover(job, error)) continue;
            } catch (recoveryError) {
              error = recoveryError;
            }
          }
          const config = await this.getConfig();
          const message = safeMessage(error.message, [
            config.torboxApiKey,
            config.realDebridApiKey,
            config.archivePassword,
          ]);
          if (job.recovery) recovery.record(job, 'needs-attention', message);
          const paused = this.pauseRequests.has(job.id);
          await this.update(job, {
            status: job.recovery?.installerStarted
              ? 'needs-setup'
              : controller.signal.aborted
                ? paused
                  ? 'paused'
                  : 'cancelled'
                : 'failed',
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
              : message +
                (job.recovery?.retryCount >= recovery.MAX_RETRIES
                  ? ' Automatic retries exhausted. Choose Retry or another download option.'
                  : ''),
          });
        } finally {
          this.controllers.delete(job.id);
          this.pauseRequests.delete(job.id);
        }
      }
    } finally {
      this.running = false;
      this.schedule();
    }
  }
  async execute(job, signal) {
    const config = await this.getConfig();
    if (job.recovery?.installerStarted)
      throw Error('Installer interrupted. Review installation before continuing.');
    job.recovery ||= recovery.checkpoint();
    const service = job.service || 'torbox';
    const serviceName = { torbox: 'TorBox', realdebrid: 'Real-Debrid', direct: 'Direct download' }[
      service
    ];
    if (!enabledServices(config).includes(service) || !hostAllowed(job.uri, config))
      throw Error(serviceName + ' or this download host is disabled in Settings.');
    const stage = within(job.root, path.join(job.root, '.mamba-downloads', job.id));
    const raw = path.join(stage, 'raw');
    const payload = path.join(stage, 'payload');
    await fs.mkdir(job.root, { recursive: true });
    await safePath(job.root, raw);
    await fs.mkdir(raw, { recursive: true });
    let destination = job.folder
      ? within(job.root, job.folder)
      : within(job.root, path.join(job.root, `${safeName(job.name)}-${job.gameId.slice(0, 6)}`));
    if (job.recovery?.renameTarget) {
      const renamed = await safePath(job.root, job.recovery.renameTarget);
      const manifest = JSON.parse(
        await fs.readFile(path.join(renamed, '.mamba-game.json'), 'utf8').catch(() => '{}'),
      );
      if (manifest.downloadId === job.id) destination = renamed;
    }
    await safePath(job.root, destination);
    job.folder = destination;
    const present = await fs.stat(destination).catch(() => null);
    if (present) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(destination, '.mamba-game.json'), 'utf8').catch(() => '{}'),
      );
      if (
        manifest.releaseId !== job.gameId ||
        (job.recovery?.payloadCommitted && manifest.downloadId !== job.id)
      )
        throw new Error('The destination already exists. Existing files were preserved.');
      if (
        manifest.status === 'installed' &&
        (!job.recovery?.payloadCommitted || job.recovery.phase === 'completed')
      ) {
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
    if (!present) {
      if (job.recovery.phase === 'committing') job.recovery.payloadCommitted = false;
      const entries = [];
      const savedFiles = job.recovery?.files;
      let localReady = Array.isArray(savedFiles) && savedFiles.length > 0;
      if (localReady)
        for (const file of savedFiles) {
          const target = await safePath(job.root, within(raw, path.join(raw, file.name)));
          const stat = await fs.stat(target).catch(() => null);
          if (!stat?.isFile() || (file.size > 0 && stat.size !== file.size)) {
            localReady = false;
            break;
          }
          entries.push({ ...file, target });
        }
      if (!localReady) {
        entries.length = 0;
        const api =
          service === 'torbox'
            ? this.apiFactory(config.torboxApiKey)
            : createService(service, config, this.fetch, job.uri);

        await this.checkpoint(job, 'downloading');
        if (!job.remote) {
          await this.update(job, { status: 'preparing', message: 'Preparing with ' + serviceName });
          job.remote = await api.create(job.uri, config.cachedOnly, signal);
          await this.persist();
        }
        let info;
        const deadline = Date.now() + (config.transferTimeoutMinutes || 120) * 60000;
        while (Date.now() < deadline) {
          signal.throwIfAborted();
          try {
            info = await api.info(job.remote.kind, job.remote.id, signal);
          } catch (cause) {
            if ([404, 410].includes(cause.status) && !job.recovery.remoteRecreated) {
              job.remote = null;
              job.recovery.remoteRecreated = true;
              await this.persist();
              throw Object.assign(
                Error('Service transfer expired. Reconnecting to the same source.'),
                { retryable: true, cause },
              );
            }
            throw cause;
          }
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
        const files = info.files.filter(
          (file) =>
            file.id !== undefined &&
            Number.isSafeInteger(Number(file.size)) &&
            Number(file.size) >= 0,
        );
        if (!files.length || files.length !== info.files.length)
          throw Error('Download service returned invalid file information.');
        const identity = files
          .map((file) => ({
            name: String(file.name || file.short_name || `file-${file.id}`).replaceAll('\\', '/'),
            size: Number(file.size),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (
          job.recovery.fileIdentity &&
          JSON.stringify(job.recovery.fileIdentity) !== JSON.stringify(identity)
        )
          throw Error('Download source returned changed content. Choose another option.');
        job.recovery.fileIdentity = identity;
        await this.persist();
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
            relative
              .split('/')
              .some(
                (part) =>
                  part === '..' ||
                  /^\.mamba(?:-|$)/i.test(part) ||
                  /[<>:"|?*\x00-\x1f]|[. ]$/.test(part) ||
                  /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part),
              ) ||
            !relative.trim()
          )
            throw new Error('TorBox returned an unsafe file path.');
          const target = within(raw, path.join(raw, relative));
          if (seen.has(target.toLowerCase()))
            throw new Error('TorBox returned colliding filenames.');
          seen.add(target.toLowerCase());
          await safePath(job.root, target);
          job.activeFile = target;
          entries.push({ ...file, size: Number(file.size), target });
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
                  progress: total
                    ? Math.min(99, Math.floor(((previous + received) / total) * 100))
                    : 0,
                },
                true,
              ).catch(() => {});
            },
            this.fetch,
            meter,
          );
          previous += Number(file.size || 0);
        }
        job.recovery.files = entries.map(({ target, size, sha256, sha1, md5 }) => ({
          name: path.relative(raw, target),
          size,
          ...(sha256 ? { sha256 } : {}),
          ...(sha1 ? { sha1 } : {}),
          ...(md5 ? { md5 } : {}),
        }));
      }
      await this.checkpoint(job, 'verifying', { lastCompletedPhase: 'downloading' });
      await this.update(job, {
        status: 'verifying',
        message: 'Checking downloaded files',
        progress: 100,
      });
      let verifiedArchives;
      try {
        verifiedArchives = await verifyDownloads(
          entries,
          { signal, password: config.archivePassword || '' },
          (message) => this.update(job, { message }, true).catch(() => {}),
        );
      } catch (error) {
        const damaged = entries.find((entry) => entry.target === error.file);
        // Multipart archive damage cannot safely be attributed to a single volume.
        const repairable =
          error.code === 'FILE_INVALID' ||
          (error.code === 'ARCHIVE_INVALID' && entries.length === 1);
        if (damaged && repairable && !job.recovery.redownloadedFile) {
          job.recovery.redownloadedFile = damaged.target;
          await this.persist();
          await fs.rm(await safePath(job.root, damaged.target), { force: true });
          await fs.rm(damaged.target + '.part', { force: true });
          await fs.rm(
            path.join(
              path.dirname(damaged.target),
              '.mamba-transfer',
              createHash('sha256').update(path.basename(damaged.target)).digest('hex') + '.json',
            ),
            { force: true },
          );
          job.recovery.files = null;
          await this.persist();
          throw Object.assign(
            Error('File verification failed. Redownloading the affected file once.'),
            { retryable: true },
          );
        }
        throw error;
      }
      await this.checkpoint(job, 'extracting', { lastCompletedPhase: 'verifying' });
      await this.update(job, {
        status: 'extracting',
        message: 'Extracting and removing wrapper folders',
        progress: 100,
      });
      if (!present) {
        const existingPayload = await fs.stat(payload).catch(() => null);
        if (existingPayload) await fs.rm(await safePath(job.root, payload), { recursive: true });
        for (let depth = 0; depth < 4; depth++)
          for (const name of [`unpack-${depth}`, `archive-layer-${depth}`])
            await fs.rm(await safePath(job.root, path.join(stage, name)), {
              recursive: true,
              force: true,
            });
        const found = await unpack(
          raw,
          payload,
          { signal, password: config.archivePassword || '', verifiedArchives },
          (message) => {
            this.update(job, { message }, true).catch(() => {});
          },
        );
        signal.throwIfAborted();
        await atomicJson(path.join(payload, '.mamba-game.json'), {
          name: job.name,
          releaseId: job.gameId,
          downloadId: job.id,
          status: 'needs-setup',
        });
        await this.checkpoint(job, 'committing', {
          lastCompletedPhase: 'extracting',
          payloadCommitted: true,
        });
        await safePath(job.root, destination);
        if (await fs.lstat(destination).catch(() => null))
          throw Error('The destination already exists. Existing files were preserved.');
        await fs.rename(payload, destination);
        await this.checkpoint(job, 'committed');
        job.hasInstaller = Boolean(found.installer);
      }
    }
    signal.throwIfAborted();
    await this.checkpoint(job, 'finalizing');
    await require('./game-helper.cjs').installGameHelper(destination);
    let found = await detect(destination);
    let status =
      found.installer && !job.recovery.installerFinished
        ? 'needs-setup'
        : found.executable && found.confidence === 'high'
          ? 'installed'
          : 'needs-setup';
    await atomicJson(path.join(destination, '.mamba-game.json'), {
      name: job.name,
      downloadId: job.id,
      version: job.version,
      release: job.release,
      releaseId: job.gameId,
      status,
      installedAt: new Date().toISOString(),
      executable: found.executable,
    });
    if (found.installer && config.autoInstall && !job.recovery.installerFinished) {
      await this.update(job, { status: 'installing', message: 'Running supported installer' });
      const installTarget = destination;
      await atomicJson(path.join(destination, '.mamba-game.json'), {
        name: job.name,
        downloadId: job.id,
        releaseId: job.gameId,
        status: 'needs-setup',
        setupInterrupted: true,
      });
      await this.checkpoint(job, 'installing', { installerStarted: true });
      const installed = await autoInstall(found.installer, installTarget, signal);
      await atomicJson(path.join(destination, '.mamba-game.json'), {
        name: job.name,
        downloadId: job.id,
        releaseId: job.gameId,
        status: 'needs-setup',
        setupInterrupted: false,
      });
      await this.checkpoint(job, 'finalizing', {
        installerStarted: false,
        installerFinished: installed,
      });
      if (installed) {
        found = await detect(installTarget);
        status = found.executable && found.confidence === 'high' ? 'installed' : 'needs-setup';
      }
    }
    let steamRegistration;
    if (status === 'installed') {
      job.name = await this.resolveName(job.name);
      signal.throwIfAborted();
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
          beforeRename: async (_from, to) =>
            this.checkpoint(job, 'finalizing', { renameTarget: to }),
          afterRename: async (to) => {
            job.folder = to;
            await this.persist();
          },
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
        downloadId: job.id,
        status,
        installedAt: new Date().toISOString(),
        executable: found.executable,
      });
      await this.reviewSetup(destination);
    }
    signal.throwIfAborted();
    await this.installMetadata(destination, { ...job, status, executable: found.executable });
    if (!config.keepArchives) {
      const stagingRoot = within(job.root, path.join(job.root, '.mamba-downloads'));
      within(stagingRoot, stage);
      if (/^[a-f0-9-]{36}$/i.test(path.basename(stage)))
        await fs
          .rm(await safePath(job.root, stage), { recursive: true, force: true })
          .catch(() => {});
    }
    await this.library.scan();
    await this.checkpoint(job, 'completed', {
      lastCompletedPhase: 'finalizing',
      nextRetryAt: null,
    });
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
    this.stopped = true;
    clearTimeout(this.retryTimer);
    for (const controller of this.controllers.values()) controller.abort();
  }
}
module.exports = { Downloads, downloadFile, RollingSpeed };
