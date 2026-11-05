const fs = require('node:fs/promises');
const path = require('node:path');
const { tokens, gameTitle } = require('./search.cjs');
const { identityKey, assessIdentity } = require('./identity-match.cjs');
const { atomicJson } = require('./atomic-json.cjs');
const key = (name) => identityKey(name, tokens(gameTitle(name).replace(/[’']/g, '')).join(' '));
function matchGame(name, items) {
  const title = tokens(gameTitle(name)).join(' ');
  const exact = items.filter(
    (item) =>
      Number.isSafeInteger(item.id) &&
      tokens(gameTitle(item.name)).join(' ') === title &&
      assessIdentity(name, item).accepted,
  );
  return exact.length === 1 ? exact[0] : null;
}
class Metadata {
  constructor(directory, catalog, transport = fetch) {
    this.file = path.join(directory, 'game-metadata.json');
    this.catalog = catalog;
    this.fetch = transport;
    this.revision = 0;
    this.entries = new Map();
    this.pending = new Map();
    this.persist = Promise.resolve();
  }
  async load() {
    try {
      this.entries = new Map(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch {}
    this.apply();
  }
  apply() {
    if (this.appliedGames === this.catalog.games && this.appliedRevision === this.revision) return;
    this.catalog.metadata = this.entries;
    this.catalog.replace(this.catalog.games || []);
    this.appliedGames = this.catalog.games;
    this.appliedRevision = this.revision;
  }
  async lookup(name) {
    const id = key(name);
    const saved = this.entries.get(id);
    if (saved && Date.now() - saved.at < (saved.steamId ? 30 : 1) * 86400000) return;
    if (this.pending.has(id)) return this.pending.get(id);
    const task = (async () => {
      try {
        const url = new URL('https://store.steampowered.com/api/storesearch/');
        url.searchParams.set('term', gameTitle(name));
        url.searchParams.set('l', 'english');
        url.searchParams.set('cc', 'CA');
        const response = await this.fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const match = matchGame(name, (await response.json()).items || []);
        this.revision++;
        this.entries.set(
          id,
          match
            ? {
                name: match.name,
                steamId: match.id,
                cover: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${match.id}/header.jpg`,
                at: Date.now(),
              }
            : { at: Date.now() },
        );
      } catch {}
    })();
    this.pending.set(id, task);
    try {
      await task;
    } finally {
      this.pending.delete(id);
    }
  }
  async search(query, offset = 0) {
    const page = this.catalog.search(query, offset);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, page.items.length) }, async () => {
        while (next < page.items.length) await this.lookup(page.items[next++].name);
      }),
    );
    this.apply();
    await this.save();
    return this.catalog.search(query, offset);
  }
  async resolveName(name) {
    await this.lookup(name);
    await this.save();
    return this.entries.get(key(name))?.name || name;
  }
  save() {
    this.persist = this.persist
      .catch(() => {})
      .then(() => atomicJson(this.file, [...this.entries]));
    return this.persist.catch(() => {});
  }
}
module.exports = { Metadata, matchGame, metadataKey: key };
