const fs = require('node:fs/promises');
const path = require('node:path');
const { download } = require('../src/core/cream-installer.cjs');
const release = require('../src/shared/cream-installer-release.json');

async function prepare() {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'vendor', 'creaminstaller');
  console.log('Preparing CreamInstaller ' + release.version + ' (verified upstream release).');
  await download(release, path.join(directory, 'CreamInstaller.exe'));
  await fs.copyFile(
    path.join(root, 'assets', 'CreamInstaller-LICENSE'),
    path.join(directory, 'LICENSE'),
  );
  await fs.writeFile(path.join(directory, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  await fs.writeFile(
    path.join(directory, 'SOURCE.txt'),
    `CreamInstaller by FroggMaster\nRelease: ${release.version}\nLicense: GNU GPL v3 (see LICENSE)\nCorresponding source: ${release.source}\nProject: https://github.com/FroggMaster/CreamInstaller\nDistributed as a separate, unmodified executable.\n`,
  );
}
module.exports = prepare;
if (require.main === module)
  prepare().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
