const { torrentHash } = require('./torbox.cjs');

function tokens(value) {
  return String(value).replace(/[™®©]/g, '').normalize('NFKC').toLowerCase().replace(/\b(?:iii|ii|iv|vi|vii|viii|ix)\b/g, (roman) => ({ ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9' })[roman]).match(/[\p{L}\p{N}]+/gu) || [];
}
function displayTitle(raw) {
  const edition = /\b(remastered|remake|deluxe|ultimate|definitive|complete|anniversary|gold|goty)\b/i;
  let title = raw.replace(/\[([^\]]*)\]/g, (_match, content) => edition.test(content) ? ' ' + content.match(edition)[0] + ' ' : ' ');
  title = title.replace(/\(([^)]*)\)/g, (match, content) => /\b(?:19|20)\d{2}\b|^\s*\d|\b(?:eng|rus|ru|en|multi\d*|fps|repack|portable|build|campaign only)\b|\bv[ .]?\d/i.test(content) ? ' ' : match);
  title = title.replace(/\s+(?:PC\s*\||repack\b|portable\b).*$/i, '');
  title = title.replace(/[.\s,–—-]+v(?:ersion)?[ .]?\d.*$/i, '').replace(/\s*[-–—,]?\s+build\s*\d.*$/i, '');
  title = title.replace(/-([A-Z0-9]{2,})$/, (match, tail) => edition.test(tail) ? match : '');
  title = title.replace(/\s+/g, ' ').replace(/^[\s\-–—|,.:]+|[\s\-–—|,.:]+$/g, '').trim();
  if (/\bcampaign\b/i.test(raw) && !/\b(multiplayer|zombies)\b/i.test(raw) && !/\bcampaign\b/i.test(title)) title += ' Campaign';
  return title || raw;
}
const collection = (name) => /\b(collection|anthology|compilation|bundle|trilogy|сборник|антология)\b|[Аа]нтология|\bcall of duty\b.*\bcall of duty\b/i.test(name);

function gameTitle(raw) {
  let title = displayTitle(String(raw));
  // Distribution labels describe a release, not a different game. Only strip
  // known trailing labels; never discard sequel numbers, remakes or remasters.
  const distribution = /(?:\s*[-–—|,:]\s*|\s+)(?:(?:license[d]?|licen[cs]e|лицензия)\s+)?(?:gog(?:[ .]com)?|steam(?:[ ._-]rip)?|epic(?: games(?: store)?)?|pc|рс|windows(?: (?:edition|version))?|magnet(?: link)?|torrent(?: download)?|early access)(?:\s+(?:edition|version))?\s*$/i;
  for (let pass = 0; pass < 6; pass++) {
    const before = title;
    title = title.replace(/\(\s*(?:early access|pc|рс|windows|gog|steam|magnet link)\s*\)/gi, ' ')
      .replace(distribution, '')
      .replace(/\s+campaign\b/ig, '')
      .replace(/\s+(?:(?:digital )?deluxe|ultimate|definitive|complete|anniversary|gold|goty)(?: edition)?\b/ig, '')
      .replace(/[\s\-–—|,.:]+$/g, '').replace(/\s+/g, ' ').trim();
    if (title === before) break;
  }
  return title || displayTitle(String(raw));
}

function createSearchIndex(games, metadata = new Map()) {
  const groups = new Map();
  for (const game of games) {
    // Campaign/edition/repack labels belong to a game's download choices.
    // Remakes and remasters stay distinct games.
    const cleaned = gameTitle(game.name);
    const info = metadata.get(tokens(cleaned.replace(/[’']/g, '')).join(' '));
    const name = info?.name || cleaned;
    const words = tokens(name);
    const key = info?.steamId ? `steam:${info.steamId}` : tokens(cleaned.replace(/[’']/g, '')).join(' ');
    let group = groups.get(key);
    if (!group) { group = { id: game.id, name, cover: info?.cover || game.cover || null, words, sources: new Set(), options: [], identities: new Map(), variants: 0, isCollection: false }; groups.set(key, group); }
    if (!group.cover && game.cover) group.cover = game.cover;
    group.variants++;
    group.isCollection ||= collection(game.name);
    for (const source of game.sources || []) group.sources.add(source);
    game.links.forEach((link, linkIndex) => {
      const identity = link.identity || torrentHash(link.uri) || link.uri;
      const existing = group.identities.get(identity);
      if (existing) { for (const source of game.sources || []) if (!existing.sources.includes(source)) existing.sources.push(source); return; }
      const option = { gameId: game.id, linkIndex, kind: link.kind, cached: link.cached, release: game.name, fileSize: game.fileSize, sources: [...(game.sources || [])], host: link.kind === 'torrents' ? 'Torrent' : new URL(link.uri).hostname };
      group.identities.set(identity, option); group.options.push(option);
    });
  }
  return [...groups.values()].map(({ identities, ...group }) => ({ ...group, sources: [...group.sources], options: group.options.map((option, index) => ({ ...option, index, label: [option.sources[0], option.fileSize, `${option.host} · ${option.cached ? 'cached' : 'supported'}`].filter(Boolean).join(' · ') })) }));
}
function rankedSearch(index, query, offset = 0) {
  const terms = tokens(query);
  if (!terms.length) return { total: 0, items: [] };
  const phrase = terms.join(' ');
  const results = [];
  for (const game of index) {
    // Long, specific searches can still include nearby title variants. Keep
    // two-word searches strict so broad one-word overlaps don't add noise.
    const matchedTerms = terms.filter((term, position) => game.words.some(word =>
      word === term || (!/^\d+$/.test(term) && term.length >= 3 && word.startsWith(term))));
    // For specific queries, retain nearby sequels/editions that share most of
    // the title. This keeps "Modern Warfare 2" useful for related MW entries.
    const minimumMatches = terms.length <= 2 ? terms.length : Math.max(2, Math.ceil(terms.length * .6));
    if (matchedTerms.length < minimumMatches) continue;
    const title = game.words.join(' ');
    const exact = title === phrase;
    const sequence = (` ${title} `).includes(` ${phrase} `);
    let span = game.words.length;
    const positions = matchedTerms.map(term => game.words.findIndex(word => word === term || (!/^\d+$/.test(term) && term.length >= 3 && word.startsWith(term)))).filter(position => position >= 0);
    if (positions.length) span = Math.max(...positions) - Math.min(...positions) + 1;
    const coverage = matchedTerms.length / terms.length;
    const score = (exact ? 10000 : 0) + (sequence ? 2000 : 0) + coverage * 1200 + matchedTerms.length * 40 - (game.isCollection ? 5000 : 0) - span * 20 - Math.max(0, game.words.length - matchedTerms.length) * 8;
    results.push({ game, score });
  }
  results.sort((a, b) => b.score - a.score || a.game.name.localeCompare(b.game.name));
  const start = Math.max(0, Number(offset) || 0);
  return { total: results.length, items: results.slice(start, start + 40).map(({ game: { words, isCollection, ...game } }) => game) };
}
function optionTraits(option) {
  const release = option.release || '';
  const incompatible = /\b(linux|macos|osx)\b/i.test(release) && !/\b(windows|win64|win32)\b/i.test(release);
  const partial = /\b(update[ ._-]*only|dlc[ ._-]*only|soundtrack[ ._-]*only|dedicated[ ._-]*server)\b|\bpatch[ ._-]+(?:only|v?\d)|\[patch\]/i.test(release);
  const english = /\b(eng|english|en|multi\d*)\b/i.test(release);
  const russianOnly = /\b(rus|russian|ru)\b/i.test(release) && !english;
  const match = release.match(/\bv[ .]?(\d+(?:\.\d+){0,5})/i) || release.match(/\((\d+\.\d+(?:\.\d+)*)\)/);
  const version = match?.[1] || release.match(/\bbuild[ ._-]*(\d+(?:\.\d+)*)/i)?.[1] || '';
  const portable = /\b(portable|pre[ -]?installed|steam[ -]?rip)\b/i.test(release);
  const score = (incompatible ? -10000 : 0) + (partial ? -5000 : 0) + (option.cached ? 1000 : 0) + (portable ? 1200 : 0) + (english ? 100 : 0) - (russianOnly ? 100 : 0);
  return { incompatible, partial, english, russianOnly, portable, version, score };
}
function rankOptions(options, preferences = {}) {
  return options.map((option) => {
    const traits = optionTraits(option);
    const language = preferences.preferredLanguage || 'english';
    if(language!=='english'){if(traits.english)traits.score-=100;if(traits.russianOnly)traits.score+=100;}
    const patterns = {english:/\b(eng|english|en|multi\d*)\b/i,russian:/\b(rus|russian|ru|multi\d*)\b/i,spanish:/\b(spa|spanish|es|multi\d*)\b/i,french:/\b(fre|french|fr|multi\d*)\b/i,german:/\b(ger|german|de|multi\d*)\b/i};
    const preferredLanguage = language !== 'any' && patterns[language]?.test(option.release);
    if (preferredLanguage) traits.score += 150;
    const releaseType = preferences.preferredRelease || 'any';
    const preferredRelease = releaseType === 'repack' ? /\brepack\b/i.test(option.release) : releaseType === 'portable' ? traits.portable : releaseType === 'original' ? !/\b(repack|portable|pre[ -]?installed)\b/i.test(option.release) : false;
    if (preferredRelease) traits.score += 80;
    const reasons = [option.cached ? 'Cached on TorBox' : 'Supported by TorBox'];
    if (traits.english) reasons.push('English / multilingual');
    if (traits.portable) reasons.push('Portable or pre-installed');
    if (traits.version) reasons.push(`Version ${traits.version}`);
    if (traits.partial) reasons.push('Update or add-on');
    if (traits.incompatible) reasons.push('Not a Windows release');
    if (preferredLanguage) reasons.push('Matches your preferred language');
    if (preferredRelease) reasons.push('Matches your preferred release type');
    return { ...option, traits, reasons };
  }).sort((a, b) => {
    if (a.traits.score !== b.traits.score) return b.traits.score - a.traits.score;
    const av = a.traits.version.split('.').map(Number); const bv = b.traits.version.split('.').map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) if ((av[i] || 0) !== (bv[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
    return b.sources.length - a.sources.length || a.release.localeCompare(b.release);
  });
}
module.exports = { tokens, displayTitle, gameTitle, createSearchIndex, rankedSearch, rankOptions, optionTraits };

