const fs = require('node:fs/promises');
const path = require('node:path');
const { buildIdentity } = require('./build-identity.cjs');

async function updateMetadata({ outDir }) {
  const fingerprint = buildIdentity();
  for (const name of await fs.readdir(outDir)) {
    if (!/^latest(?:-linux)?\.yml$/.test(name)) continue;
    const file = path.join(outDir, name);
    const metadata = (await fs.readFile(file, 'utf8')).replace(/^mambaBuildHash:.*\r?\n/gm, '');
    if (
      !metadata.startsWith('version: ' + require('../package.json').version + '\n') &&
      !metadata.startsWith('version: ' + require('../package.json').version + '\r\n')
    )
      continue;
    await fs.writeFile(file, metadata + '\nmambaBuildHash: ' + fingerprint + '\n');
  }
  return [];
}
module.exports = updateMetadata;
if (require.main === module)
  updateMetadata({ outDir: path.resolve(__dirname, '..', 'dist') }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
