const fs = require('node:fs/promises');
const { sourceText, mergeDownloads } = require('../src/core/catalog.cjs');
async function combine(urls) {
  const accumulator = { games: new Map(), records: 0 };
  if (!Array.isArray(urls)) throw Error('Sources must be a list of URLs.');
  for (const url of new Set(urls)) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.search)
      throw Error('Use public HTTPS source URLs without credentials or query parameters.');
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('Source unavailable: ' + u.hostname);
    const text = await sourceText(response);
    const source = JSON.parse(text);
    if (!Array.isArray(source.downloads)) throw Error('Invalid source: ' + u.hostname);
    mergeDownloads([{ name: source.name || u.hostname, downloads: source.downloads }], accumulator);
  }
  return {
    name: 'Mamba MegaSource',
    downloads: [...accumulator.games.values()]
      .map((game) => ({
        title: game.name,
        fileSize: game.fileSize,
        uploadDate: game.uploadDate,
        uris: game.links.map((link) => link.uri),
      }))
      .filter((game) => game.uris.length)
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}
if (require.main === module)
  (async () => {
    const urls = JSON.parse(
      await fs.readFile(process.argv[2] || 'config/mega-sources.json', 'utf8'),
    );
    const result = await combine(urls);
    await fs.mkdir('dist', { recursive: true });
    await fs.writeFile('dist/megasource.json', JSON.stringify(result));
    console.log(result.downloads.length + ' combined releases');
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { combine };
