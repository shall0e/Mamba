const fs = require('node:fs/promises');
const path = require('node:path');

async function xboxManaged(folder) {
  if (
    path
      .resolve(folder)
      .split(path.sep)
      .some((part) => part.toLowerCase() === 'windowsapps')
  )
    return true;
  for (const base of [folder, path.join(folder, 'Content')]) {
    if ((await fs.stat(path.join(base, 'MicrosoftGame.config')).catch(() => null))?.isFile())
      return true;
  }
  return false;
}
async function removeUnmanagedInstallation(folder) {
  if (await xboxManaged(folder))
    throw Error('Uninstall this game through the Xbox app or Windows Installed apps.');
  try {
    await fs.rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch (error) {
    if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code))
      throw Object.assign(
        new Error(
          'Windows could not remove some game files. Close the game and its launcher, then try again. For games managed by Xbox, Steam, or another launcher, uninstall through that app. Some files may already have been removed.',
        ),
        { code: error.code },
      );
    throw error;
  }
}
module.exports = { xboxManaged, removeUnmanagedInstallation };
