const { createHash } = require('node:crypto');
const API = 'https://api.torbox.app/v1/api';
const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      reject(new Error('Cancelled'));
    }
    signal?.addEventListener('abort', cancel, { once: true });
  });

function torrentHash(uri) {
  try {
    const xt = [...new URL(uri).searchParams].find(
      ([key, value]) => key.toLowerCase() === 'xt' && /^urn:btih:/i.test(value),
    )?.[1];
    const hash = xt?.slice(9);
    if (/^[a-f0-9]{40}$/i.test(hash || '')) return hash.toLowerCase();
    if (/^[a-z2-7]{32}$/i.test(hash || '')) {
      let bits = '';
      for (const c of hash.toUpperCase())
        bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
      return Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2))).toString('hex');
    }
  } catch {}
  return null;
}

class TorBox {
  constructor(key, transport = fetch) {
    this.key = key;
    this.fetch = transport;
    this.lastRequest = 0;
  }
  async request(route, { query = {}, method = 'GET', body, signal } = {}) {
    if (!this.key) throw new Error('Add your TorBox API key in Settings.');
    await delay(Math.max(0, 260 - (Date.now() - this.lastRequest)), signal);
    const url = new URL(API + route);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
    for (let attempt = 0; attempt < 4; attempt++) {
      this.lastRequest = Date.now();
      const timeout = AbortSignal.timeout(60000);
      let response;
      try {
        response = await this.fetch(url, {
          method,
          body,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: {
            Authorization: `Bearer ${this.key}`,
            Accept: 'application/json',
            ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          },
        });
      } catch (error) {
        if (signal?.aborted || attempt === 3)
          throw new Error(
            signal?.aborted ? 'Cancelled' : 'TorBox connection failed. Retry the operation.',
            { cause: error },
          );
        await delay(1000 * 2 ** attempt, signal);
        continue;
      }
      if (response.status >= 500 && attempt < 3) {
        await delay(1500 * 2 ** attempt, signal);
        continue;
      }
      if (response.status === 429 && attempt < 3) {
        const error = new Error(
          'TorBox rate limit reached. Availability checks will resume automatically.',
        );
        error.status = 429;
        const retry = response.headers.get('retry-after');
        error.retryAfter = /^\d+$/.test(retry || '')
          ? Number(retry) * 1000
          : Math.max(60000, Date.parse(retry || '') - Date.now() || 120000);
        throw error;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.success === false) {
        const message =
          typeof data?.detail === 'string'
            ? data.detail
            : `TorBox request failed (${response.status}).`;
        throw Object.assign(new Error(message.replaceAll(this.key, '[key]')), {
          status: response.status,
          retryAfter: require('./recovery.cjs').retryAfter(response.headers.get('retry-after')),
        });
      }
      return data.data;
    }
  }
  async cached(kind, hashes, signal) {
    if (!hashes.length) return new Set();
    const data = await this.request(`/${kind}/checkcached`, {
      method: 'POST',
      body: JSON.stringify({ hashes }),
      query: { format: 'object' },
      signal,
    });
    if (Array.isArray(data))
      return new Set(
        data
          .map((item) => (typeof item === 'string' ? item : item.hash))
          .filter(Boolean)
          .map((hash) => hash.toLowerCase()),
      );
    return new Set(
      Object.entries(data || {})
        .filter(([, value]) => value && (typeof value !== 'object' || Object.keys(value).length))
        .map(([hash]) => hash.toLowerCase()),
    );
  }
  async create(uri, cachedOnly, signal) {
    const kind = torrentHash(uri) ? 'torrents' : 'webdl';
    const form = kind === 'torrents' ? new FormData() : new URLSearchParams();
    form.set(kind === 'torrents' ? 'magnet' : 'link', uri);
    form.set('add_only_if_cached', String(cachedOnly));
    if (kind === 'torrents') {
      form.set('seed', '3');
      form.set('allow_zip', 'true');
    }
    const data = await this.request(
      `/${kind}/${kind === 'torrents' ? 'createtorrent' : 'createwebdownload'}`,
      { method: 'POST', body: form, signal },
    );
    const id =
      data?.[kind === 'torrents' ? 'torrent_id' : 'webdownload_id'] ?? data?.web_id ?? data?.id;
    if (id === undefined || id === null) throw new Error('TorBox did not return a transfer ID.');
    return { kind, id };
  }
  async info(kind, id, signal) {
    const result = await this.request(`/${kind}/mylist`, {
      query: { id, bypass_cache: true },
      signal,
    });
    return Array.isArray(result) ? result.find((item) => String(item.id) === String(id)) : result;
  }
  async downloadLink(kind, id, fileId, signal) {
    const result = await this.request(`/${kind}/requestdl`, {
      query: {
        token: this.key,
        [kind === 'torrents' ? 'torrent_id' : 'web_id']: id,
        file_id: fileId,
        redirect: false,
      },
      signal,
    });
    const url = typeof result === 'string' ? result : result?.url;
    if (!url || new URL(url).protocol !== 'https:')
      throw new Error('TorBox did not return a secure download link.');
    return url;
  }
}
const webHash = (uri) => createHash('md5').update(uri).digest('hex');
module.exports = { TorBox, torrentHash, webHash, delay };
