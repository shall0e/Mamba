const fs = require('node:fs/promises');
const path = require('node:path');

async function installedMetadata(folder) {
  for (const base of [folder, path.join(folder, 'Content')]) {
    const xml = await fs.readFile(path.join(base, 'MicrosoftGame.config'), 'utf8').catch(() => '');
    if (!xml) continue;
    const value = (tag) =>
      xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]+)</' + tag + '>', 'i'))?.[1]?.trim();
    const title = value('DefaultDisplayName') || value('DisplayName');
    let cover = null;
    for (const tag of [
      'SplashScreenImage',
      'Square480x480Logo',
      'Square150x150Logo',
      'Square44x44Logo',
    ]) {
      const relative = value(tag);
      if (!relative || !/\.(png|jpe?g|webp)$/i.test(relative)) continue;
      try {
        const file = await require('./library.cjs').safePath(folder, path.resolve(base, relative));
        const stat = await fs.stat(file);
        if (stat.size > 2 * 1024 * 1024) continue;
        const bytes = await fs.readFile(file);
        const type = /\.png$/i.test(file) ? 'png' : /\.webp$/i.test(file) ? 'webp' : 'jpeg';
        cover = `data:image/${type};base64,${bytes.toString('base64')}`;
        break;
      } catch {}
    }
    return {
      name: title && !/^(?:ms-resource:|@)/i.test(title) ? title.replace(/&amp;/g, '&') : null,
      cover,
    };
  }
  return {};
}

async function steamFolders(root) {
  if (
    path.basename(root).toLowerCase() !== 'common' ||
    path.basename(path.dirname(root)).toLowerCase() !== 'steamapps'
  )
    return new Map();
  const parent = path.dirname(root);
  const files = await fs.readdir(parent).catch(() => []);
  const entries = await Promise.all(
    files
      .filter((name) => /^appmanifest_\d+\.acf$/i.test(name))
      .map(async (name) => {
        const text = await fs.readFile(path.join(parent, name), 'utf8').catch(() => '');
        const field = (key) => text.match(new RegExp('"' + key + '"\\s+"([^"\\r\\n]+)"', 'i'))?.[1];
        return [field('installdir')?.toLowerCase(), field('name')];
      }),
  );
  return new Map(entries.filter(([folder, name]) => folder && name));
}
module.exports = { installedMetadata, steamFolders };
