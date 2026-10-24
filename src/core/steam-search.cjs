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
const { releaseHints, assessIdentity } = require('./identity-match.cjs');

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
  if (!assessIdentity(source.name, app).accepted) return false;
  if (compactTitle(source.name) === compactTitle(app.name)) return true;

  // A remaster may omit a franchise number when its full distinct subtitle remains.
  // Do not drop sequel numbers from plain titles such as "Game 2".
  const words = actual.split(' ');
  const numbers = words
    .map((word, index) => (/^\d+$/.test(word) ? index : -1))
    .filter((index) => index >= 0);
  const index = numbers[0];
  return (
    releaseHints(source.name).edition === 'remaster' &&
    numbers.length === 1 &&
    index >= 2 &&
    words.length - index - 1 >= 3 &&
    words.filter((_word, position) => position !== index).join(' ') === wanted
  );
}

function topicQueries(query) {
  const clean = String(query)
    .replace(/\b(?:latest|newest)\b/gi, '')
    .trim();
  const words = titleKey(clean).split(' ').filter(Boolean);
  const withoutOne = clean.replace(/\b1\b/g, '').replace(/\s+/g, ' ').trim();
  const core = words.filter((word) => !/^\d+$/.test(word));
  const meaningful = core.filter((word) => !['the', 'a', 'an', 'of', 'and', 'for'].includes(word));
  const family = meaningful.length > 2 ? meaningful.slice(0, 2).join(' ') : '';
  return [...new Set([clean, withoutOne, core.join(' '), family].filter(Boolean))].slice(0, 4);
}
function chooseBestMatch(query, items) {
  const latest = /\b(?:latest|newest)\b/i.test(query);
  const clean = topicQueries(query)[0].replace(/\b1\b/g, '').replace(/\s+/g, ' ').trim();
  const hints = releaseHints(clean);
  const wanted = compactTitle(
    hints.year ? clean.replace(new RegExp('\\b' + hints.year + '\\b'), '') : clean,
  );
  if (!wanted || wanted.length < 4) return null;
  let exact = items.filter(
    (game) =>
      compactTitle(game.name) === wanted ||
      compactTitle(game.name.replace(/\s*\(\d{4}\)$/, '')) === wanted,
  );
  if (!exact.length) {
    const phrase = titleKey(
      hints.year ? clean.replace(new RegExp('\\b' + hints.year + '\\b'), '') : clean,
    );
    if (phrase.split(' ').length >= 2)
      exact = items.filter((game) =>
        titleKey(game.name.replace(/\s*\(\d{4}\)$/, '')).endsWith(' ' + phrase),
      );
  }
  if (latest) {
    const candidates = items
      .filter((game) => !game.isFree && game.verified && !game.related && game.releaseYear)
      .sort((a, b) => Number(b.releaseYear) - Number(a.releaseYear));
    return candidates.length &&
      (candidates.length === 1 || candidates[0].releaseYear !== candidates[1].releaseYear)
      ? candidates[0]
      : null;
  }
  let eligible = exact.filter(
    (game) =>
      !game.isFree && game.verified && (!hints.year || String(game.releaseYear) === hints.year),
  );
  // Preserve the user's numeral spelling when normalized titles collide.
  const numerals = String(query).match(/\b(?:ii|iii|iv|vi|vii|viii|ix|x)\b/gi);
  if (eligible.length > 1 && numerals?.length) {
    const spelled = eligible.filter((game) =>
      numerals.every((numeral) => new RegExp('\\b' + numeral + '\\b', 'i').test(game.name)),
    );
    if (spelled.length) eligible = spelled;
  }
  const uncertain = exact.some(
    (game) =>
      !game.isFree && !game.verified && (!hints.year || String(game.releaseYear) === hints.year),
  );
  return eligible.length === 1 && !uncertain ? eligible[0] : null;
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
    this.subtitleIndex = new Map();
  }
  async load() {
    try {
      this.queries = new Map(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch {}
    for (const { data } of this.identity.cache?.values() || [])
      if (
        data?.type === 'game' &&
        !require('./game-identity.cjs').isNonGame(data) &&
        !data.isFree &&
        data.detailsVersion !== 5 &&
        data.steamId &&
        data.cover
      )
        this.apps.set('steam:' + data.steamId, data);
    this.indexSources();
  }
  indexSources() {
    if (this.indexedGames === this.catalog.games) return;
    this.indexedGames = this.catalog.games;
    this.sourceIndex.clear();
    this.subtitleIndex.clear();
    for (const source of this.catalog.games) {
      const key = compactTitle(source.name);
      if (!this.sourceIndex.has(key)) this.sourceIndex.set(key, []);
      this.sourceIndex.get(key).push(source);
      const parts = titleKey(source.name).split(' ');
      if (releaseHints(source.name).edition === 'remaster') {
        const alias = parts
          .filter((word) => !/^\d+$/.test(word))
          .join(' ')
          .replace(/[^a-z0-9]/g, '');
        if (!this.subtitleIndex.has(alias)) this.subtitleIndex.set(alias, []);
        this.subtitleIndex.get(alias).push(source);
      }
    }
    this.groups.clear();
    this.ambiguous.clear();
  }
  releasesFor(app) {
    this.indexSources();
    const key = compactTitle(app.name);
    const releases = this.sourceIndex.get(key) || [];
    const alias = this.subtitleIndex.get(key) || [];
    return [
      ...new Map([...releases, ...alias].map((source) => [source.id, source])).values(),
    ].filter((source) => sourceMatches(source, app));
  }

  localResults(query, offset = 0) {
    this.indexSources();
    const index = [...this.apps.values()].map((app) => ({
      ...app,
      id: 'steam:' + app.steamId,
      words: tokens(app.name),
      isCollection: false,
    }));

    const queries = topicQueries(query);
    const primaryQueries = /\b1\b/.test(query) ? queries.slice(0, 2) : queries.slice(0, 1);
    const firstGameAlias = /\b1\b/.test(query);
    const primaryCandidate = (game) =>
      !firstGameAlias || !tokens(game.name).some((word) => /^\d{1,3}$/.test(word) && word !== '1');
    const direct = new Set(
      primaryQueries
        .flatMap((term) => rankedSearch(index, term, 0).items)
        .filter(primaryCandidate)
        .filter((app) =>
          primaryQueries.some((term) =>
            (' ' + titleKey(app.name) + ' ').includes(' ' + titleKey(term) + ' '),
          ),
        )
        .map((app) => app.id),
    );
    const matching = [
      ...new Map(
        queries.flatMap((term) => rankedSearch(index, term, 0).items).map((app) => [app.id, app]),
      ).values(),
    ];
    const phrase = titleKey(topicQueries(query)[0])
      .split(' ')
      .filter((word) => !/^\d+$/.test(word))
      .join(' ');
    const entries = matching
      .filter(
        (app) =>
          phrase.split(' ').length < 2 ||
          (' ' + titleKey(app.name) + ' ').includes(' ' + phrase + ' '),
      )
      .map((app) => ({ app, releases: this.releasesFor(app) }));
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
        group.related = !direct.has(group.id);
        items.push(group);
        this.groups.set(group.id, {
          games: this.catalog.games,
          ambiguous: this.ambiguous.size,
          group,
        });
      }
    }
    const relevance = (game) =>
      Math.max(
        ...primaryQueries.map((term) => {
          const wanted = titleKey(term);
          const title = titleKey(game.name);
          return (
            (title === wanted ? 4 : (' ' + title + ' ').includes(' ' + wanted + ' ') ? 2 : 0) +
            titleSimilarity(term, game.name)
          );
        }),
      );
    items.sort((a, b) => Number(a.related) - Number(b.related) || relevance(b) - relevance(a));
    const bestMatch = chooseBestMatch(query, items, matching);
    const start = Math.max(0, Number(offset) || 0);
    return { total: items.length, items: items.slice(start, start + 40), bestMatch };
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
    if (app.isFree || !releases.length) return null;
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
    const sourceYears = [
      ...new Set(releases.map((release) => releaseHints(release.name).year).filter(Boolean)),
    ];
    const year =
      String(
        app.originalReleaseYear ||
          releaseHints(app.name).year ||
          (sourceYears.length === 1 ? sourceYears[0] : null) ||
          app.releaseDate ||
          '',
      ).match(/\b(?:19|20)\d{2}\b/)?.[0] || null;
    const sizes = [...new Set(group.options.map((option) => option.fileSize).filter(Boolean))];
    return {
      ...group,
      id: 'steam:' + app.steamId,
      steamId: app.steamId,
      name: app.name,
      cover: app.cover,
      releaseYear: year,
      releaseYearLabel:
        year && !app.originalReleaseYear && !releaseHints(app.name).year && sourceYears.length !== 1
          ? 'Steam release ' + year
          : year,
      downloadSize: sizes[0] || null,
      verified: true,
    };
  }
  forApp(app) {
    if (
      !app ||
      app.isFree ||
      app.type !== 'game' ||
      require('./game-identity.cjs').isNonGame(app) ||
      !app.steamId ||
      !app.cover
    )
      return null;
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
        if (this.activeQuery === key && this.searches.get(key) === state) {
          const result = this.localResults(query);
          this.onResults?.(query, {
            ...result,
            bestMatch: result.bestMatch,
            pending: state.pending,
          });
        }
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
    const result = this.localResults(query, offset);
    return {
      ...result,
      bestMatch: result.bestMatch,
      pending: state.pending,
    };
  }
  async enrich(query, publish = () => {}) {
    const revision = ++this.searchRevision;
    query = String(query || '')
      .trim()
      .slice(0, 300);
    if (!query) return { total: 0, items: [] };
    const queries = topicQueries(query);
    const [candidateLists, sourceLists] = await Promise.all([
      Promise.all(queries.slice(0, 2).map((term) => this.steamResults(term).catch(() => []))),
      Promise.all(queries.map((term) => Promise.resolve(this.catalog.search(term, 0).items || []))),
    ]);
    const candidates = [
      ...new Map(candidateLists.flat().map((candidate) => [candidate.id, candidate])).values(),
    ];
    const sourceResults = [...new Map(sourceLists.flat().map((item) => [item.id, item])).values()];
    const record = (app) => {
      if (app?.type !== 'game' || require('./game-identity.cjs').isNonGame(app) || app.isFree)
        return;
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
    const sourceCandidates = this.identity.identify
      ? [...new Map(sourceResults.map((item) => [item.id, item])).values()].slice(0, 24)
      : [];
    const sourceTask = (async () => {
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, sourceCandidates.length) }, async () => {
          while (index < sourceCandidates.length && revision === this.searchRevision) {
            const item = sourceCandidates[index++];
            const identity = await this.identity
              .identify(item.identityTitle || item.name)
              .catch(() => null);
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
module.exports = {
  SteamSearch,
  titleKey,
  compactTitle,
  titleSimilarity,
  sourceMatches,
  topicQueries,
  chooseBestMatch,
};
