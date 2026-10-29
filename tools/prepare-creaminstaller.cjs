const fs = require('node:fs/promises');
const path = require('node:path');
const { download } = require('../src/core/cream-installer.cjs');
const release = require('../src/shared/cream-installer-release.json');

async function prepare(context) {
  if (context?.packager) {
    context.packager.config.extraMetadata = {
      ...context.packager.config.extraMetadata,
      mambaBuildHash: require('./build-identity.cjs').buildIdentity(),
    };
  }
  if (context?.electronPlatformName && context.electronPlatformName !== 'win32') {
    context.packager.config.extraResources = [];
    const generated = path.resolve(__dirname, '../vendor/linux-cli');
    await fs.mkdir(generated, { recursive: true });
    const wrapper = (await fs.readFile(path.join(__dirname, 'mamba-installed'), 'utf8')).replace(
      '@MAMBA_EXECUTABLE@',
      context.packager.executableName,
    );
    await fs.writeFile(path.join(generated, 'mamba-cli'), wrapper, { mode: 0o755 });
    context.packager.config.extraFiles = [
      { from: path.join(generated, 'mamba-cli'), to: 'mamba-cli' },
    ];
    const templates = path.resolve(
      path.dirname(require.resolve('app-builder-lib')),
      '../templates/linux',
    );
    const install = await fs.readFile(path.join(templates, 'after-install.tpl'), 'utf8');
    const remove = await fs.readFile(path.join(templates, 'after-remove.tpl'), 'utf8');
    await fs.writeFile(
      path.join(generated, 'after-install.tpl'),
      install +
        "\nchmod 755 '/opt/${sanitizedProductName}/mamba-cli'\nif [ ! -e /usr/local/bin/mamba ] || [ \"$(readlink /usr/local/bin/mamba)\" = '/opt/${sanitizedProductName}/mamba-cli' ]; then\n  ln -sf '/opt/${sanitizedProductName}/mamba-cli' /usr/local/bin/mamba\nfi\n",
    );
    await fs.writeFile(
      path.join(generated, 'after-remove.tpl'),
      remove +
        '\nif [ "$(readlink /usr/local/bin/mamba)" = \'/opt/${sanitizedProductName}/mamba-cli\' ]; then\n  rm -f /usr/local/bin/mamba\nfi\n',
    );
    context.packager.config.deb = {
      ...context.packager.config.deb,
      afterInstall: path.join(generated, 'after-install.tpl'),
      afterRemove: path.join(generated, 'after-remove.tpl'),
    };
    return;
  }
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
