const fs = require('node:fs/promises');
const path = require('node:path');
const {
  gameTitle,
  tokens,
  createSearchIndex,
  optionTraits,
  rankedSearch,
} = require('./search.cjs');
const { atomicJson } = require('./catalog.cjs');

function titleKey(raw) {
  const cleaned = gameTitle(String(raw).replace(/[._]+/g, ' ')).replace(/[’']/g, '');
  let words = tokens(cleaned.replace(/([a-z])(\d)/gi, '$1 $2')).map((word) =>
    word === 'v' ? '5' : word,
  );
  const aliases = {
    cod: ['call', 'of', 'duty'],
    gta: ['grand', 'theft', 'auto'],
    rdr: ['red', 'dead', 'redemption'],
  };
  if (Object.hasOwn(aliases, words[0])) words = [...aliases[words[0]], ...words.slice(1)];
  return words.join(' ');
}
function compactTitle(raw) {
  return titleKey(raw).replace(/[^a-z0-9]/g, '');
}
function titleSimilarity(left, right) {
  const a = compactTitle(left),
    b = compactTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aw = new Set(titleKey(left).split(' ')),
    bw = new Set(titleKey(right).split(' '));
  const overlap = [...aw].filter((word) => bw.has(word)).length;
  const dice = (2 * overlap) / (aw.size + bw.size || 1);
  const shorter = Math.min(a.length, b.length),
    longer = Math.max(a.length, b.length);
  const prefix = a.startsWith(b) || b.startsWith(a) ? shorter / longer : 0;
  return Math.max(dice, prefix);
}
function sourceMatches(source, app) {
  const wanted = titleKey(app.name),
    actual = titleKey(source.name);
  const sourceYear = source.name.match(/\(\s*((?:19|20)\d{2})\s*\)/)?.[1];
  const steamYear =
    app.name.match(/\(\s*((?:19|20)\d{2})\s*\)/)?.[1] ||
    String(app.releaseDate || '').match(/\b((?:19|20)\d{2})\b/)?.[1];
  if (sourceYear && steamYear && sourceYear !== steamYear) return false;
  if (compactTitle(source.name) === compactTitle(app.name)) return true;

  return (
    wanted === 'call of duty modern warfare remastered' &&
    actual === 'call of duty 4 modern warfare remastered'
  );
}
class SteamSearch {
  constructor(directory, catalog, identity, transport = fetch) {
    this.file = path.join(directory, 'steam-search.json');
    this.catalog = catalog;
    this.identity = identity;
    this.fetch = transport;
    this.groups = new Map();
    this.ambiguous = new Set();
    this.queries = new Map();
    this.apps = new Map();
    this.pending = new Map();
    this.writes = Promise.resolve();
    this.searchRevision = 0;
    this.searches = new Map();
    this.sourceIndex = new Map();
  }
  async load() {
    try {
      this.queries = new Map(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch {}
    for (const { data } of this.identity.cache?.values() || [])
      if (data?.type === 'game' && data.steamId && data.cover)
        this.apps.set('steam:' + data.steamId, data);
    this.indexSources();
  }
  indexSources() {
    if (this.indexedGames === this.catalog.games) return;
    this.indexedGames = this.catalog.games;
    this.sourceIndex.clear();
    for (const source of this.catalog.games) {
      const key = compactTitle(source.name);
      if (!this.sourceIndex.has(key)) this.sourceIndex.set(key, []);
      this.sourceIndex.get(key).push(source);
    }
    this.groups.clear();
    this.ambiguous.clear();
  }
  releasesFor(app) {
    this.indexSources();
    const key = compactTitle(app.name);
    const releases = this.sourceIndex.get(key) || [];
    const alias =
      key === 'callofdutymodernwarfareremastered'
        ? this.sourceIndex.get('callofduty4modernwarfareremastered') || []
        : [];
    return [...releases, ...alias].filter((source) => sourceMatches(source, app));
  }
  localResults(query, offset = 0) {
    this.indexSources();
    const index = [...this.apps.values()].map((app) => ({
      ...app,
      id: 'steam:' + app.steamId,
      words: tokens(app.name),
      isCollection: false,
    }));

    const matching = rankedSearch(index, query, 0).items;
    const entries = matching.map((app) => ({ app, releases: this.releasesFor(app) }));
    const claims = new Map();
    for (const { releases } of entries)
      for (const source of releases) claims.set(source.id, (claims.get(source.id) || 0) + 1);
    for (const [id, count] of claims) if (count > 1) this.ambiguous.add(id);
    const items = [];
    for (const { app, releases } of entries) {
      const safe = releases.filter(
        (source) => claims.get(source.id) === 1 && !this.ambiguous.has(source.id),
      );
      if (!safe.length) continue;
      const group = this.group(app, safe);
      if (group) {
        items.push(group);
        this.groups.set(group.id, {
          games: this.catalog.games,
          ambiguous: this.ambiguous.size,
          group,
        });
      }
    }
    const start = Math.max(0, Number(offset) || 0);
    return { total: items.length, items: items.slice(start, start + 40) };
  }
  async save() {
    this.writes = this.writes
      .catch(() => {})
      .then(() => atomicJson(this.file, [...this.queries].slice(-50)));
    await this.writes;
  }
  async steamResults(query) {
    const key = query.trim().toLowerCase(),
      saved = this.queries.get(key);
    if (saved && Date.now() - saved.at < 15 * 60000) return saved.items;
    if (this.pending.has(key)) return this.pending.get(key);
    const request = (async () => {
      try {
        const url = new URL('https://store.steampowered.com/api/storesearch/');
        url.searchParams.set('term', query);
        url.searchParams.set('l', 'english');
        url.searchParams.set('cc', 'CA');
        const response = await this.fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw Error('Steam search is unavailable. Try again shortly.');
        const data = await response.json();
        if (!Array.isArray(data.items)) throw Error('Steam returned an unreadable search result.');
        const unique = new Map();
        for (const item of data.items)
          if (
            Number.isSafeInteger(item.id) &&
            item.id > 0 &&
            typeof item.name === 'string' &&
            (!item.type || item.type === 'app')
          )
            unique.set(item.id, item);
        const items = [...unique.values()];
        this.queries.set(key, { at: Date.now(), items });
        while (this.queries.size > 50) this.queries.delete(this.queries.keys().next().value);
        this.save().catch(() => {});
        return items;
      } catch (error) {
        if (saved && Date.now() - saved.at < 7 * 86400000) return saved.items;
        throw error;
      }
    })();
    this.pending.set(key, request);
    try {
      return await request;
    } finally {
      this.pending.delete(key);
    }
  }
  group(app, releases) {
    if (!releases.length) return null;
    const combined = createSearchIndex(releases.map((release) => ({ ...release, name: app.name })));
    const group = combined[0];
    if (!group) return null;

    const byId = this.catalog.byId;
    group.options = group.options.map((option) => ({
      ...option,
      release: byId.get(option.gameId)?.name || option.release,
    }));
    if (
      !group.options.some((option) => {
        const traits = optionTraits(option);
        return !traits.partial && !traits.incompatible;
      })
    )
      return null;
    const year =
      String(app.releaseDate || app.name.match(/\b(?:19|20)\d{2}\b/)?.[0] || '').match(
        /\b(?:19|20)\d{2}\b/,
      )?.[0] || null;
    const sizes = [...new Set(group.options.map((option) => option.fileSize).filter(Boolean))];
    return {
      ...group,
      id: 'steam:' + app.steamId,
      steamId: app.steamId,
      name: app.name,
      cover: app.cover,
      releaseYear: year,
      downloadSize: sizes[0] || null,
      verified: true,
    };
  }
  forApp(app) {
    if (!app || app.type !== 'game' || !app.steamId || !app.cover) return null;
    this.apps.set('steam:' + app.steamId, app);
    const releases = this.releasesFor(app).filter((source) => !this.ambiguous.has(source.id));
    return this.group(app, releases);
  }
  get(id) {
    const saved = this.groups.get(id);
    if (saved && saved.games === this.catalog.games && saved.ambiguous === this.ambiguous.size)
      return saved.group;
    const app = this.apps.get(id);
    const group = app ? this.forApp(app) : null;
    if (group)
      this.groups.set(id, { games: this.catalog.games, ambiguous: this.ambiguous.size, group });
    return group;
  }
  async search(query, offset = 0) {
    query = String(query || '')
      .trim()
      .slice(0, 300);
    if (!query) return { total: 0, items: [], pending: false };
    const key = query.toLowerCase(),
      changed = this.activeQuery !== key;
    this.activeQuery = key;
    let state = this.searches.get(key);
    if (
      !state ||
      state.games !== this.catalog.games ||
      (changed && state.pending) ||
      (!state.pending && Date.now() - state.at > 60000)
    ) {
      state = { pending: true, at: Date.now(), games: this.catalog.games };
      this.searches.set(key, state);
      while (this.searches.size > 40) this.searches.delete(this.searches.keys().next().value);
      const publish = () => {
        if (this.activeQuery === key && this.searches.get(key) === state)
          this.onResults?.(query, { ...this.localResults(query), pending: state.pending });
      };
      state.work = Promise.resolve()
        .then(() => this.enrich(query, publish))
        .catch(() => {})
        .finally(() => {
          state.pending = false;
          state.at = Date.now();
          publish();
        });
    }
    return { ...this.localResults(query, offset), pending: state.pending };
  }
  async enrich(query, publish = () => {}) {
    const revision = ++this.searchRevision;
    query = String(query || '')
      .trim()
      .slice(0, 300);
    if (!query) return { total: 0, items: [] };
    const words = query.split(/\s+/).filter(Boolean);
    const relaxedQuery =
      words.length > 1 ? words.filter((word) => !/^\d{1,4}$/.test(word)).join(' ') : '';
    const [candidates, sourceLists] = await Promise.all([
      this.steamResults(query),
      Promise.all(
        [query, relaxedQuery]
          .filter(Boolean)
          .map((term) => Promise.resolve(this.catalog.search(term, 0).items || [])),
      ),
    ]);
    const sourceResults = [
      ...new Map(sourceLists.flat().map((item) => [compactTitle(item.name), item])).values(),
    ];
    const record = (app) => {
      if (app?.type !== 'game') return;
      this.apps.set('steam:' + app.steamId, app);
      if (revision === this.searchRevision) publish();
    };
    const directTask = (async () => {
      let index = 0;
      const work = candidates.slice(0, 24);
      await Promise.all(
        Array.from({ length: Math.min(3, work.length) }, async () => {
          while (index < work.length && revision === this.searchRevision) {
            const candidate = work[index++];
            const app = await this.identity.details(candidate.id).catch(() => null);
            record(app);
          }
        }),
      );
    })();
    const directNames = new Set(candidates.map((candidate) => compactTitle(candidate.name)));
    const sourceCandidates = this.identity.identify
      ? [
          ...new Map(
            sourceResults
              .filter((item) => !directNames.has(compactTitle(item.name)))
              .map((item) => [compactTitle(item.name), item]),
          ).values(),
        ].slice(0, 24)
      : [];
    const sourceTask = (async () => {
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, sourceCandidates.length) }, async () => {
          while (index < sourceCandidates.length && revision === this.searchRevision) {
            const item = sourceCandidates[index++];
            const identity = await this.identity.identify(item.name).catch(() => null);
            if (!identity?.verified || identity.type !== 'game' || !identity.steamId) continue;
            const app = await this.identity.details(identity.steamId).catch(() => identity);
            record(app);
          }
        }),
      );
    })();

    await Promise.all([directTask, sourceTask]);
    this.identity.save().catch(() => {});
  }
}
module.exports = { SteamSearch, titleKey, compactTitle, titleSimilarity, sourceMatches };
