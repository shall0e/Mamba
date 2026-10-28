const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assessIdentity, releaseHints } = require('./identity-match.cjs');

function exactGameName(left, right) {
  return require('./game-identity.cjs').matchesTitle(left, right);
}
class Artwork {
  constructor(directory, catalog, transport = fetch) {
    this.directory = path.join(directory, 'artwork');
    this.catalog = catalog;
    this.fetch = transport;
    this.pending = new Map();
    this.active = 0;
    this.waiting = [];
  }
  get(id) {
    if (this.pending.has(id)) return this.pending.get(id);
    const task = new Promise((resolve, reject) => {
      this.waiting.push({ id, resolve, reject });
    });
    this.pending.set(id, task);
    this.drain();
    return task;
  }
  drain() {
    while (this.active < 4 && this.waiting.length) {
      const { id, resolve, reject } = this.waiting.shift();
      this.active++;
      this.load(id)
        .then(resolve, reject)
        .finally(() => {
          this.pending.delete(id);
          this.active--;
          this.drain();
        });
    }
  }
  async load(id) {
    const game =
      this.catalog.getGame?.(id) ||
      this.catalog.searchIndex?.find((entry) => entry.id === id) ||
      this.catalog.library?.get(id);
    if (
      !game ||
      game.identityUncertain ||
      (!game.verified && releaseHints(game.identityTitle || game.name).year)
    )
      return null;
    if (/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(game.cover || ''))
      return game.cover;
    const cache = path.join(
      this.directory,
      createHash('sha256')
        .update('identity-v3|' + (game.identityTitle || game.name) + (game.cover || ''))
        .digest('hex') + '.json',
    );
    try {
      const saved = JSON.parse(await fs.readFile(cache, 'utf8'));
      const ttl = saved.image ? 30 * 86400000 : game.verified ? 60000 : 86400000;
      if (Number.isFinite(saved.at) && Date.now() - saved.at >= 0 && Date.now() - saved.at < ttl)
        return saved.image;
    } catch {}
    let url = game.cover;
    try {
      if (!url) {
        const search = new URL('https://store.steampowered.com/api/storesearch/');
        search.searchParams.set('term', game.name);
        search.searchParams.set('l', 'english');
        search.searchParams.set('cc', 'CA');
        const response = await this.fetch(search, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
          await response.body?.cancel();
          throw Error('Artwork search unavailable');
        }
        const data = await response.json();
        const matches = (data.items || []).filter(
          (item) =>
            Number.isSafeInteger(item.id) &&
            exactGameName(game.name, item.name) &&
            assessIdentity(game.identityTitle || game.name, { name: item.name }).accepted,
        );
        const match = matches.length === 1 ? matches[0] : null;
        if (match)
          url = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${match.id}/header.jpg`;
      }
      let image = null;
      if (url && new URL(url).protocol === 'https:') {
        const response = await this.fetch(url, { signal: AbortSignal.timeout(8000) });
        const type = response.headers.get('content-type')?.split(';')[0];
        if (
          response.ok &&
          ['image/jpeg', 'image/png', 'image/webp'].includes(type) &&
          Number(response.headers.get('content-length') || 0) <= 2 * 1024 * 1024
        ) {
          const reader = response.body.getReader();
          const chunks = [];
          let length = 0;
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              length += part.value.length;
              if (length > 2 * 1024 * 1024) {
                await reader.cancel();
                throw new Error('Artwork too large');
              }
              chunks.push(Buffer.from(part.value));
            }
            image = `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
          } finally {
            reader.releaseLock();
          }
        } else {
          await response.body?.cancel();
        }
      }
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(cache, JSON.stringify({ image, at: Date.now() }));
      return image;
    } catch {
      await fs
        .mkdir(this.directory, { recursive: true })
        .then(() => fs.writeFile(cache, JSON.stringify({ image: null, at: Date.now() })))
        .catch(() => {});
      return null;
    }
  }
}
module.exports = { Artwork, exactGameName };
