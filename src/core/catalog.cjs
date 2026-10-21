const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { TorBox, torrentHash, webHash } = require('./torbox.cjs');
const { createSearchIndex, rankedSearch, rankOptions } = require('./search.cjs');
const {
  enabledServices,
  hostKey,
  hostAllowed,
  candidates,
  RealDebrid,
} = require('./download-services.cjs');

async function sourceText(response) {
  const limit = 250 * 1024 * 1024;
  if (Number(response.headers?.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Source exceeds 250 MB.');
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw new Error('Source exceeds 250 MB.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Source exceeds 250 MB.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(data), 'utf8');
  await fs.rename(file + '.tmp', file);
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
const titleKey = (title) =>
  title
    .replace(/[™®©]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function linkIdentity(uri) {
  return torrentHash(uri) || uri;
}

function mergeDownloads(sources, accumulator) {
  const games = accumulator?.games || new Map();
  let records = accumulator?.records || 0;
  for (const source of sources) {
    for (const row of source.downloads) {
      if (typeof row?.title !== 'string' || !Array.isArray(row.uris)) continue;
      const name = row.title.trim().slice(0, 500);
      if (!name) continue;
      const key = titleKey(name);
      let game = games.get(key);
      if (!game) {
        game = {
          id: digest(key).slice(0, 24),
          name,
          fileSize: String(row.fileSize || '').slice(0, 100),
          uploadDate: row.uploadDate || null,
          cover: null,
          sources: [],
          occurrences: 0,
          links: [],
        };
        games.set(key, game);
      }
      records++;
      const cover = row.cover || row.coverUrl;
      if (!game.cover && typeof cover === 'string' && cover.startsWith('https://'))
        game.cover = cover;
      game.occurrences++;
      if (!game.sources.includes(source.name)) game.sources.push(source.name);
      for (const value of row.uris) {
        if (typeof value !== 'string' || value.length > 12000) continue;
        let url;
        try {
          url = new URL(value);
        } catch {
          continue;
        }
        const hash = torrentHash(value);

        if (!hash && url.protocol !== 'https:') continue;
        const identity = linkIdentity(value);
        if (!game.links.some((link) => link.identity === identity))
          game.links.push({
            identity,
            uri: value,
            kind: hash ? 'torrents' : 'webdl',
            hash: hash || webHash(value),
          });
      }
    }
  }
  if (accumulator) {
    accumulator.records = records;
    return;
  }
  return { games: [...games.values()].filter((game) => game.links.length), records };
}

class Catalog extends EventEmitter {
  constructor(
    directory,
    getConfig,
    { transport = fetch, apiFactory = (key) => new TorBox(key, transport) } = {},
  ) {
    super();
    this.file = path.join(directory, 'catalog.json');
    this.getConfig = getConfig;
    this.fetch = transport;
    this.apiFactory = apiFactory;
    this.availabilityFile = path.join(directory, 'torbox-availability.json');
    this.availability = {};
    this.retryTimer = null;
    this.games = [];
    this.byId = new Map();
    this.state = {
      phase: 'idle',
      message: 'Catalog not synced yet.',
      count: 0,
      linkCount: 0,
      errors: [],
    };
    this.controller = null;
    this.queue = Promise.resolve();
  }
  status(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.state);
    return this.state;
  }
  async load() {
    try {
      this.availability = JSON.parse(await fs.readFile(this.availabilityFile, 'utf8'));
    } catch {}
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.replace(saved.games || []);
      this.signature = saved.signature;
      this.pending = saved.pending;
      this.sourceHosts = saved.sourceHosts || {};
      this.status({
        phase: saved.pending?.length
          ? saved.phase === 'checking'
            ? 'interrupted'
            : 'needs-key'
          : 'ready',
        count: this.games.length,
        updatedAt: saved.updatedAt,
        message: `${this.games.length.toLocaleString()} releases available`,
        errors: saved.errors || [],
      });
    } catch (error) {
      if (error.code !== 'ENOENT')
        this.status({ phase: 'error', message: 'The saved catalog could not be read.' });
    }
  }
  replace(games) {
    this.state.linkCount = games.reduce((total, game) => total + (game.links?.length || 0), 0);
    this.games = games;
    this.byId = new Map(games.map((game) => [game.id, game]));
    this.searchIndex = createSearchIndex(games, this.metadata);
  }
  search(query, offset = 0) {
    return rankedSearch(this.searchIndex || [], query, offset);
  }
  getGame(id) {
    return this.steamSearch?.get(id) || this.searchIndex?.find((entry) => entry.id === id);
  }
  async recoveryCandidates(job, config) {
    const hash = torrentHash(job.uri);
    if (!hash) return [];
    const game =
      this.getGame(job.gameId) ||
      this.searchIndex?.find((entry) =>
        entry.options.some((option) => option.gameId === job.gameId),
      );
    const resolved = game ? await this.resolveGame(game.id) : null;
    const options = resolved?.options || [{ gameId: job.gameId, linkIndex: 0, available: true }];
    const result = [];
    for (const option of options) {
      const release = this.byId.get(option.gameId);
      const link = release?.links[option.linkIndex];
      if (
        !option.available ||
        !link ||
        torrentHash(link.uri) !== hash ||
        !hostAllowed(link.uri, config)
      )
        continue;
      for (const service of option.services || link.services || ['torbox']) {
        if (service === job.service || !enabledServices(config).includes(service)) continue;
        if (
          (service === 'torbox' && !config.torboxApiKey) ||
          (service === 'realdebrid' && !config.realDebridApiKey)
        )
          continue;
        result.push({ uri: link.uri, service });
      }
    }
    return result;
  }
  async resolveGame(id) {
    const game = this.getGame(id);
    if (!game) throw new Error('This game is no longer in the catalog. Search again.');
    const releases = this.byId;
    const config = await this.getConfig();
    const api = this.apiFactory(config.torboxApiKey);
    const verified = game.options.map((option) => ({ ...option }));
    for (const option of verified) {
      const link = releases.get(option.gameId)?.links[option.linkIndex];
      option.services = (link?.services || ['torbox']).filter(
        (service) =>
          enabledServices(config).includes(service) &&
          (service !== 'torbox' || config.torboxApiKey) &&
          (service !== 'realdebrid' || config.realDebridApiKey),
      );
      option.available = !!link && hostAllowed(link.uri, config) && option.services.length > 0;
    }
    for (const kind of ['torrents', 'webdl']) {
      const options = verified.filter(
        (option) => option.kind === kind && option.available && option.services.includes('torbox'),
      );
      for (let start = 0; start < options.length; start += 1000) {
        const batch = options.slice(start, start + 1000);
        const hashes = batch.map(
          (option) =>
            releases.get(option.gameId)?.links[option.linkIndex]?.hash ||
            (kind === 'torrents'
              ? torrentHash(releases.get(option.gameId)?.links[option.linkIndex]?.uri)
              : webHash(releases.get(option.gameId)?.links[option.linkIndex]?.uri)),
        );
        const cached = await api.cached(kind, hashes);
        batch.forEach((option, index) => {
          option.cached = cached.has(hashes[index]);
          if (!option.cached && config.cachedOnly)
            option.services = option.services.filter((service) => service !== 'torbox');
          const link = releases.get(option.gameId)?.links[option.linkIndex];
          option.available = hostAllowed(link.uri, config) && option.services.length > 0;
        });
      }
    }
    const options = rankOptions(verified, config);
    const best =
      options.find(
        (option) => option.available && !option.traits.incompatible && !option.traits.partial,
      ) || null;
    return {
      id: game.id,
      name: game.name,
      sources: game.sources,
      options,
      best,
      message: best
        ? 'Best available match'
        : 'No complete Windows-compatible download is currently available.',
    };
  }
  sync(force = false) {
    clearTimeout(this.retryTimer);
    this.controller?.abort();
    const task = this.queue.catch(() => {}).then(() => this.performSync(force));
    this.queue = task;
    return task;
  }
  async performSync(force = false) {
    const config = await this.getConfig();
    const sourceUrls = config.sourceUrls.filter(
      (uri) => !(config.disabledSourceUrls || []).includes(uri),
    );
    const signature = digest(
      JSON.stringify([
        sourceUrls,
        digest(config.torboxApiKey || ''),
        config.cachedOnly,
        enabledServices(config),
        digest(config.realDebridApiKey || ''),
        config.disabledDownloadHosts || [],
      ]),
    );
    if (!force && this.signature === signature && ['ready', 'needs-key'].includes(this.state.phase))
      return this.state;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const errors = [];
    const resume = this.pending?.length && this.signature === signature;
    if (resume) errors.push(...(this.state.errors || []));
    let merged, duplicates, allLinks, valid;
    const publish = () =>
      merged.games
        .map((game) => ({
          ...game,
          links: game.links
            .filter((link) => valid.has(link.identity))
            .map((link) => allLinks.get(link.identity)),
        }))
        .filter((game) => game.links.length)
        .sort((a, b) => a.name.localeCompare(b.name));
    this.status({
      phase: 'fetching',
      message: 'Fetching sources…',
      completed: 0,
      total: sourceUrls.length,
      errors,
    });
    try {
      const accumulator = { games: new Map(), records: 0 };
      let sourceCount = 0;
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < sourceUrls.length && !signal.aborted) {
          const url = sourceUrls[next++];
          try {
            const response = await this.fetch(url, {
              signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const raw = await sourceText(response);
            const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
            const downloads = Array.isArray(data) ? data : data.downloads;
            if (!Array.isArray(downloads)) throw new Error('Expected a Hydra downloads array.');
            mergeDownloads(
              [{ name: String(data.name || new URL(url).hostname), downloads }],
              accumulator,
            );
            sourceCount++;
          } catch (error) {
            if (!signal.aborted) errors.push({ source: url, message: error.message.slice(0, 200) });
          }
          if (!signal.aborted)
            this.status({
              completed: ++done,
              message: `Fetched ${done} of ${sourceUrls.length} sources`,
              errors,
            });
        }
      };
      if (!resume) await Promise.all([worker(), worker()]);
      signal.throwIfAborted();
      if (!resume && !sourceCount && sourceUrls.length)
        throw new Error('No sources could be fetched. Your previous catalog is preserved.');
      this.status({ phase: 'merging', message: 'Merging releases and removing duplicate links…' });
      merged = resume
        ? {
            games: this.pending,
            records: this.pending.reduce((total, game) => total + game.occurrences, 0),
          }
        : {
            games: [...accumulator.games.values()].filter((game) => game.links.length),
            records: accumulator.records,
          };
      accumulator.games.clear();
      for (const game of merged.games)
        for (const link of game.links)
          if (link.kind === 'torrents') link.uri = `magnet:?xt=urn:btih:${link.hash}`;
      this.sourceHosts = {};
      for (const game of merged.games)
        for (const link of game.links) {
          const host = hostKey(link.uri);
          this.sourceHosts[host] = (this.sourceHosts[host] || 0) + 1;
        }
      duplicates = merged.games
        .filter((game) => game.occurrences > 1)
        .map(({ id, name, occurrences, sources }) => ({ id, name, occurrences, sources }));
      const torboxEnabled = enabledServices(config).includes('torbox') && !!config.torboxApiKey;
      if (
        !torboxEnabled &&
        !enabledServices(config).includes('direct') &&
        !(enabledServices(config).includes('realdebrid') && config.realDebridApiKey) &&
        merged.games.length
      ) {
        await atomicJson(this.file, {
          version: 1,
          signature,
          updatedAt: new Date().toISOString(),
          games: [],
          pending: merged.games,
          duplicates,
          errors,
          sourceHosts: this.sourceHosts,
        });
        this.replace([]);
        this.signature = signature;
        this.pending = merged.games;
        return this.status({
          phase: 'needs-key',
          count: 0,
          mergedCount: merged.games.length,
          message: `Merged ${merged.games.length.toLocaleString()} releases. Enable a download service in Settings.`,
          errors,
        });
      }
      const api = this.apiFactory(config.torboxApiKey);
      await atomicJson(this.file, {
        version: 1,
        signature,
        phase: 'checking',
        updatedAt: new Date().toISOString(),
        games: this.games,
        pending: merged.games,
        duplicates,
        errors,
        sourceHosts: this.sourceHosts,
      });
      this.pending = merged.games;
      this.signature = signature;
      allLinks = new Map();
      for (const game of merged.games)
        for (const link of game.links) allLinks.set(link.identity, link);
      valid = new Set();
      let rdHosts = [];
      if (enabledServices(config).includes('realdebrid') && config.realDebridApiKey) {
        try {
          rdHosts = await new RealDebrid(config.realDebridApiKey, this.fetch).hosts(signal);
        } catch (error) {
          errors.push({ source: 'Real-Debrid', message: error.message });
        }
      }
      for (const link of allLinks.values()) {
        link.services = candidates(link, config, rdHosts);
        if (link.services.length) valid.add(link.identity);
      }
      this.status({
        phase: 'checking',
        completed: 0,
        total: allLinks.size,
        message: 'Checking download services…',
      });
      let completed = 0;
      let hosters = [];
      if (torboxEnabled && !config.cachedOnly) {
        const data = await api.request('/webdl/hosters', { signal });
        const values = Array.isArray(data) ? data : Object.values(data || {});
        hosters = values
          .filter((host) => host.status !== false)
          .flatMap((host) => host.domains || host.supported_domains || [host.domain || host.name])
          .filter((host) => typeof host === 'string')
          .map((host) =>
            host
              .toLowerCase()
              .replace(/^https?:\/\//, '')
              .replace(/\/$/, ''),
          );
      }
      for (const kind of ['torrents', 'webdl']) {
        const links = [...allLinks.values()].filter(
          (link) => link.kind === kind && hostAllowed(link.uri, config),
        );
        for (let i = 0; i < links.length; i += 5000) {
          signal.throwIfAborted();
          const batch = links.slice(i, i + 5000);
          const unknown = batch.filter(
            (link) =>
              !this.availability[`${kind}:${link.hash}`] ||
              Date.now() - this.availability[`${kind}:${link.hash}`].at > 3600000,
          );
          const cached = torboxEnabled
            ? await api.cached(
                kind,
                unknown.map((link) => link.hash),
                signal,
              )
            : new Set();
          for (const link of torboxEnabled ? unknown : [])
            this.availability[`${kind}:${link.hash}`] = {
              cached: cached.has(link.hash),
              at: Date.now(),
            };
          for (const link of batch) {
            link.cached =
              torboxEnabled && this.availability[`${kind}:${link.hash}`]?.cached === true;
            const supported =
              kind === 'torrents' ||
              hosters.some(
                (host) =>
                  new URL(link.uri).hostname === host ||
                  new URL(link.uri).hostname.endsWith('.' + host),
              );
            if (
              torboxEnabled &&
              hostAllowed(link.uri, config) &&
              (link.cached || (!config.cachedOnly && supported))
            ) {
              valid.add(link.identity);
              link.services.push('torbox');
            }
          }
          completed += batch.length;
          this.status({
            completed,
            message: `Checked ${completed.toLocaleString()} of ${allLinks.size.toLocaleString()} links`,
          });
          if (i % 50000 === 0) {
            await atomicJson(this.availabilityFile, this.availability);
            this.replace(publish());
            this.status({ count: this.games.length });
          }
        }
      }
      const games = publish();
      signal.throwIfAborted();
      const updatedAt = new Date().toISOString();
      await atomicJson(this.file, {
        version: 1,
        signature,
        updatedAt,
        records: merged.records,
        excluded: merged.games.length - games.length,
        games,
        duplicates,
        errors,
        sourceHosts: this.sourceHosts,
      });
      this.replace(games);
      this.signature = signature;
      this.pending = null;
      return this.status({
        phase: 'ready',
        count: games.length,
        duplicateCount: duplicates.length,
        updatedAt,
        message: `${games.length.toLocaleString()} releases available`,
        errors,
      });
    } catch (error) {
      if (!signal.aborted) {
        if (merged && valid && allLinks) {
          this.replace(publish());
          await atomicJson(this.file, {
            version: 1,
            signature,
            phase: 'checking',
            updatedAt: new Date().toISOString(),
            games: this.games,
            pending: merged.games,
            duplicates,
            errors,
            sourceHosts: this.sourceHosts,
          });
        }
        if (error.status === 429) {
          const wait = Math.max(60000, error.retryAfter || 120000);
          this.status({
            phase: 'waiting',
            count: this.games.length,
            retryAt: new Date(Date.now() + wait).toISOString(),
            message: error.message,
            errors,
          });
          this.retryTimer = setTimeout(() => this.sync().catch(() => {}), wait);
        } else
          this.status({ phase: 'error', count: this.games.length, message: error.message, errors });
      }
      return this.state;
    } finally {
      await atomicJson(this.availabilityFile, this.availability);
      if (this.controller === controller) this.controller = null;
    }
  }
}
module.exports = { Catalog, mergeDownloads, atomicJson, titleKey };
