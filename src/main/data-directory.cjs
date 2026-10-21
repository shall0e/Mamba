const fs = require('node:fs');
const path = require('node:path');
function localDataDirectory(root) {
  const directory = path.join(root, 'data');
  fs.mkdirSync(directory, { recursive: true });
  for (const entry of fs.readdirSync(root)) {
    if (
      !/^(?:(?:config|catalog|downloads|game-identities|game-metadata|steam-search|library-state|issues|themes|torbox-availability)\.json(?:\..*)?|background-crashes\.log|torbox-openapi\.tmp\.json|artwork)$/.test(
        entry,
      )
    )
      continue;
    const destination = path.join(directory, entry);
    if (!fs.existsSync(destination)) fs.renameSync(path.join(root, entry), destination);
  }
  return directory;
}
module.exports = { localDataDirectory };
