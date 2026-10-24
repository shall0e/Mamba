// Identity evidence is retained independently from display-title cleanup.
const IDENTITY_VERSION = 3;
function releaseHints(raw) {
  const text = String(raw || '');
  const year =
    text.match(/[([]\s*((?:19|20)\d{2})(?=[\s,;\])])/)?.[1] ||
    text.match(/(?:^|\s)((?:19|20)\d{2})\s*$/)?.[1] ||
    null;
  const edition = /\bremaster(?:ed)?\b/i.test(text)
    ? 'remaster'
    : /\bremake\b/i.test(text)
      ? 'remake'
      : null;
  return { year, edition, mod: /\b(?:mod|modification)\b/i.test(text) };
}
function assessIdentity(raw, app, sameTitle = true) {
  if (!sameTitle || !app) return { accepted: false, confidence: 0, reason: 'title-conflict' };
  const source = releaseHints(raw);
  const target = releaseHints(app.name);
  const compact = (value) =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  if (source.mod !== target.mod && compact(raw) !== compact(app.name))
    return { accepted: false, confidence: 0, reason: 'mod-conflict' };
  if (source.edition !== target.edition)
    return { accepted: false, confidence: 0, reason: 'edition-conflict' };
  const years = [
    target.year,
    app.originalReleaseYear,
    ...(app.releaseYears || []),
    String(app.releaseDate || '').match(/\b((?:19|20)\d{2})\b/)?.[1],
  ]
    .filter(Boolean)
    .map(String);
  if (source.year && !years.includes(source.year))
    return {
      accepted: false,
      confidence: 0,
      reason: years.length ? 'year-conflict' : 'year-unconfirmed',
    };
  if (app.isHub && !/\b(?:launcher|hub)\b/i.test(String(raw)))
    return { accepted: false, confidence: 0, reason: 'launcher-conflict' };
  return {
    accepted: true,
    confidence: source.year ? 1 : 0.9,
    reason: source.year ? 'title-and-year' : 'exact-title',
  };
}
function identityKey(raw, normalized) {
  const hints = releaseHints(raw);
  return `${IDENTITY_VERSION}:${normalized}|${hints.year || ''}|${hints.edition || ''}|${hints.mod ? 'mod' : ''}`;
}
module.exports = { IDENTITY_VERSION, releaseHints, assessIdentity, identityKey };
