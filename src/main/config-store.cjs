const fs = require('node:fs/promises');
const path = require('node:path');
const defaultPalette = require('../shared/palette-defaults.json');
const { Themes } = require('../core/themes.cjs');
function createConfigStore({
  app,
  safeStorage,
  dataDirectory,
  reportIssue,
  onChange,
  getInstalledGames,
}) {
  const publicConfig = (config) => ({
    onboardingCompleted: config.onboardingCompleted !== false,
    appearance: config.appearance || null,
    enabledDownloadServices: config.enabledDownloadServices || ['torbox', 'direct'],
    preferredDownloadService: config.preferredDownloadService || 'auto',
    disabledDownloadHosts: config.disabledDownloadHosts || [],
    disabledSourceUrls: config.disabledSourceUrls || [],
    realDebridConfigured: !!config.realDebridApiKey,
    librarySort: config.librarySort || 'name',
    libraryFavoritesOnly: !!config.libraryFavoritesOnly,
    notifications: config.notifications !== false,
    preferredLanguage: config.preferredLanguage || 'english',
    preferredRelease: config.preferredRelease || 'any',
    configured: Boolean(config.torboxApiKey),
    sourceUrls: config.sourceUrls,
    palette: config.palette,
    downloadPath: config.downloadPath,
    automaticRecovery: config.automaticRecovery === true,
    autoInstall: config.autoInstall,
    cachedOnly: config.cachedOnly,
    archivePassword: config.archivePassword || '',
    keepArchives: Boolean(config.keepArchives),
    transferTimeoutMinutes: config.transferTimeoutMinutes || 120,
    automaticUpdates: config.automaticUpdates !== false,
  });

  function readPalette(palette) {
    return Object.fromEntries(
      Object.entries(defaultPalette).map(([name, fallback]) => [
        name,
        typeof palette?.[name] === 'string' && /^#[0-9a-f]{6}$/i.test(palette[name])
          ? palette[name]
          : fallback,
      ]),
    );
  }

  const configFile = () => path.join(dataDirectory(), 'config.json');
  let themeStore;
  const getThemeStore = () => themeStore || (themeStore = new Themes(dataDirectory()));
  let configQueue = Promise.resolve();

  async function readConfig() {
    try {
      const config = JSON.parse(await fs.readFile(configFile(), 'utf8'));
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new Error('Invalid config.json. Expected an object.');
      return {
        ...config,
        onboardingCompleted: config.onboardingCompleted !== false,
        palette: readPalette(config.palette),
        downloadPath:
          typeof config.downloadPath === 'string' && path.isAbsolute(config.downloadPath)
            ? path.resolve(config.downloadPath)
            : path.join(app.getPath('downloads'), 'Mamba'),
        automaticRecovery: config.automaticRecovery === true,
        autoInstall: config.autoInstall !== false,
        keepArchives: config.keepArchives === true,
        automaticUpdates: config.automaticUpdates !== false,
        notifications: config.notifications !== false,
        preferredLanguage: ['any', 'english', 'russian', 'spanish', 'french', 'german'].includes(
          config.preferredLanguage,
        )
          ? config.preferredLanguage
          : 'english',
        preferredRelease: ['any', 'repack', 'portable', 'original'].includes(
          config.preferredRelease,
        )
          ? config.preferredRelease
          : 'any',
        librarySort: ['name', 'recent', 'installed'].includes(config.librarySort)
          ? config.librarySort
          : 'name',
        libraryFavoritesOnly: config.libraryFavoritesOnly === true,
        cachedOnly: config.cachedOnly !== false,
        transferTimeoutMinutes: Math.max(
          5,
          Math.min(1440, Number(config.transferTimeoutMinutes) || 120),
        ),
        torboxApiKey: typeof config.torboxApiKey === 'string' ? config.torboxApiKey : '',
        realDebridApiKey:
          typeof config.realDebridApiKey === 'string' ? config.realDebridApiKey : '',
        enabledDownloadServices: Array.isArray(config.enabledDownloadServices)
          ? config.enabledDownloadServices.filter((id) =>
              ['torbox', 'realdebrid', 'direct'].includes(id),
            )
          : ['torbox', 'direct'],
        preferredDownloadService: ['auto', 'torbox', 'realdebrid', 'direct'].includes(
          config.preferredDownloadService,
        )
          ? config.preferredDownloadService
          : 'auto',
        disabledDownloadHosts: Array.isArray(config.disabledDownloadHosts)
          ? config.disabledDownloadHosts.filter((host) => typeof host === 'string')
          : [],
        disabledSourceUrls: Array.isArray(config.disabledSourceUrls)
          ? config.disabledSourceUrls.filter((uri) => typeof uri === 'string')
          : [],
        sourceUrls: Array.isArray(config.sourceUrls)
          ? config.sourceUrls.filter((url) => typeof url === 'string')
          : [],
      };
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        error.message === 'Invalid config.json. Expected an object.'
      ) {
        await fs.rename(configFile(), configFile() + '.invalid-' + Date.now() + '.backup');
        reportIssue(
          new Error(
            'The settings file was unreadable. It was backed up and defaults were restored. Open Settings to reconnect TorBox and choose your Games folder.',
          ),
          'config',
        );
        return readConfig();
      }
      if (error.code !== 'ENOENT') throw error;

      let torboxApiKey = '';
      try {
        const legacy = JSON.parse(
          await fs.readFile(path.join(app.getPath('userData'), 'torbox-key.json'), 'utf8'),
        );
        if (legacy.encryptedKey && safeStorage.isEncryptionAvailable()) {
          torboxApiKey = safeStorage.decryptString(Buffer.from(legacy.encryptedKey, 'base64'));
        }
      } catch (legacyError) {
        if (legacyError.code !== 'ENOENT') throw legacyError;
      }
      return {
        onboardingCompleted: false,
        notifications: true,
        preferredLanguage: 'english',
        preferredRelease: 'portable',
        librarySort: 'name',
        libraryFavoritesOnly: false,
        torboxApiKey,
        sourceUrls: [],
        palette: { ...defaultPalette },
        downloadPath: path.join(app.getPath('downloads'), 'Mamba'),
        automaticRecovery: false,
        autoInstall: true,
        cachedOnly: true,
        keepArchives: false,
        automaticUpdates: true,
        transferTimeoutMinutes: 120,
      };
    }
  }

  async function writeConfig(config) {
    const destination = configFile();
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(`${destination}.tmp`, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await fs.rename(`${destination}.tmp`, destination);
  }

  function updateConfig(update) {
    const pending = configQueue.then(async () => {
      const config = await readConfig();
      await update(config);
      await writeConfig(config);
      await onChange();
      return { ...publicConfig(config), installedGames: getInstalledGames() };
    });
    configQueue = pending.catch(() => {});
    return pending;
  }

  return {
    readConfig,
    updateConfig,
    publicConfig,
    configFile,
    getThemeStore,
    flush: () => configQueue,
  };
}
module.exports = { createConfigStore };
