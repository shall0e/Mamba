const fs = require('node:fs/promises');
const path = require('node:path');
const { safePath } = require('./library.cjs');

async function writeSteamAppId(folder, executable, steamId) {
  const id = Number(steamId);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff) return false;
  const directories = new Set([path.resolve(folder)]);
  if (executable) {
    const file = await safePath(folder, path.resolve(folder, executable));
    directories.add(path.dirname(file));
  }
  for (const directory of directories) {
    const target = await safePath(folder, path.join(directory, 'steam_appid.txt'));
    await fs.writeFile(target, String(id) + '\n', 'utf8');
  }
  return true;
}

module.exports = { writeSteamAppId };
