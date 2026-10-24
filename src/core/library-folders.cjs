const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeFolders(folders) {
  if (
    !Array.isArray(folders) ||
    folders.some((folder) => typeof folder !== 'string' || !path.isAbsolute(folder.trim()))
  )
    throw Error('Extra game folders must be a list of absolute folder paths.');
  const unique = new Map();
  for (const folder of folders) {
    const resolved = path.resolve(folder.trim());
    if (resolved === path.parse(resolved).root)
      throw Error('Choose a games folder, not an entire drive.');
    unique.set(resolved.toLowerCase(), resolved);
  }
  return [...unique.values()];
}

async function defaultFolders() {
  if (process.platform !== 'win32') return [];
  const candidates = [];
  for (let code = 65; code <= 90; code++) {
    const drive = String.fromCharCode(code) + ':\\';
    for (const relative of [
      'SteamLibrary\\steamapps\\common',
      'Games',
      'XboxGames',
      'Program Files (x86)\\Steam\\steamapps\\common',
      'Program Files\\Epic Games',
      'Steam\\steamapps\\common',
      'GOG Games',
      'EA Games',
      'Program Files\\EA Games',
      'Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games',
      'Program Files\\Rockstar Games',
    ])
      candidates.push(path.join(drive, relative));
  }
  const existing = await Promise.all(
    candidates.map(async (folder) =>
      (await fs.stat(folder).catch(() => null))?.isDirectory() ? folder : null,
    ),
  );
  return normalizeFolders(existing.filter(Boolean));
}

async function scanRoots(config, discovered = []) {
  const roots = normalizeFolders([
    config.downloadPath,
    ...(config.extraGameFolders || []),
    ...discovered,
  ]);
  // Accept either a Steam library folder or its common games folder.
  const expanded = await Promise.all(
    roots.map(async (folder) => {
      const common = path.join(folder, 'steamapps', 'common');
      return (await fs.stat(common).catch(() => null))?.isDirectory() ? common : folder;
    }),
  );
  return normalizeFolders(expanded);
}
module.exports = { normalizeFolders, defaultFolders, scanRoots };
