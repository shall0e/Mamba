const fs = require('node:fs/promises');
const path = require('node:path');
const defaultPalette = require('../shared/palette-defaults.json');
const { Themes } = require('../core/themes.cjs');
const { withConfigLock, writePrivateConfig } = require('../core/config-file.cjs');
const { validateSettings } = require('../core/config-transfer.cjs');
const { defaultFolders, normalizeFolders } = require('../core/library-folders.cjs');

function validatedFields(settings, keys) {
  const fields = {};
  for (const key of keys) {
    if (settings[key] !== undefined) fields[key] = settings[key];
  }
  return validateSettings(fields);
}

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
    sidebarCollapsed: config.sidebarCollapsed === true,
    appearance: config.appearance || null,
    enabledDownloadServices: config.enabledDownloadServices || ['torbox', 'direct'],
    preferredDownloadService: config.preferredDownloadService || 'auto',
    disabledDownloadHosts: config.disabledDownloadHosts || [],
    disabledSourceUrls: config.disabledSourceUrls || [],
    realDebridConfigured: !!config.realDebridApiKey,
    librarySort: config.librarySort || 'name',
    libraryView: config.libraryView || 'cards',
    libraryShowUnknown: config.libraryShowUnknown === true,
    automaticGameDetection: config.automaticGameDetection !== false,
    steamLibraryIntegration: config.steamLibraryIntegration !== false,
    libraryAvailability: config.libraryAvailability || 'all',
    libraryFavoritesOnly: !!config.libraryFavoritesOnly,
    notifications: config.notifications !== false,
    preferredLanguage: config.preferredLanguage || 'english',
    preferredRelease: config.preferredRelease || 'any',
    configured: Boolean(config.torboxApiKey),
    sourceUrls: config.sourceUrls,
    palette: config.palette,
    downloadPath: config.downloadPath,
    extraGameFolders: config.extraGameFolders || [],
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

  async function readLegacyTorBoxKey() {
    try {
      const legacy = JSON.parse(
        await fs.readFile(path.join(app.getPath('userData'), 'torbox-key.json'), 'utf8'),
      );
      if (legacy.encryptedKey && safeStorage.isEncryptionAvailable())
        return safeStorage.decryptString(Buffer.from(legacy.encryptedKey, 'base64'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return '';
  }

  async function readConfig() {
    try {
      if (process.platform !== 'win32') await fs.chmod(configFile(), 0o600);
      const config = JSON.parse(await fs.readFile(configFile(), 'utf8'));
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new Error('Invalid config.json. Expected an object.');
      return {
        ...config,
        extraGameFolders:
          config.extraGameFolders === undefined
            ? await defaultFolders()
            : normalizeFolders(config.extraGameFolders),
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
        preferredRelease: ['any', 'repack', 'portable', 'original', 'onlinefix'].includes(
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

      const torboxApiKey = await readLegacyTorBoxKey();
      return {
        onboardingCompleted: false,
        extraGameFolders: await defaultFolders(),
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
    await writePrivateConfig(configFile(), config);
  }

  function updateConfig(update) {
    const pending = configQueue.then(async () => {
      let changed = false;
      const config = await withConfigLock(configFile(), async () => {
        const current = await readConfig();
        const previous = JSON.stringify(current);
        await update(current);
        changed = JSON.stringify(current) !== previous;
        if (changed) await writeConfig(current);
        return current;
      });
      if (changed) await onChange();
      return { ...publicConfig(config), installedGames: getInstalledGames() };
    });
    configQueue = pending.catch(() => {});
    return pending;
  }

  function saveSettings(settings) {
    return updateConfig((config) => {
      if (!settings || !Array.isArray(settings.sourceUrls) || typeof settings.apiKey !== 'string') {
        throw new Error('Invalid settings.');
      }
      const urls = settings.sourceUrls.map((value) => {
        if (typeof value !== 'string') throw new Error('Invalid source URL.');
        const url = value.trim();
        if (!['http:', 'https:'].includes(new URL(url).protocol))
          throw new Error('Sources must be HTTP or HTTPS JSON URLs.');
        return url;
      });
      if (settings.apiKey.trim()) config.torboxApiKey = settings.apiKey.trim();
      if (typeof settings.realDebridApiKey === 'string' && settings.realDebridApiKey.trim())
        config.realDebridApiKey = settings.realDebridApiKey.trim();
      Object.assign(
        config,
        validatedFields(settings, [
          'enabledDownloadServices',
          'preferredDownloadService',
          'disabledDownloadHosts',
          'disabledSourceUrls',
        ]),
      );
      config.sourceUrls = [...new Set(urls)];
      if (settings.extraGameFolders !== undefined)
        config.extraGameFolders = normalizeFolders(settings.extraGameFolders);
      if (settings.downloadPath !== undefined) {
        if (
          typeof settings.downloadPath !== 'string' ||
          !path.isAbsolute(settings.downloadPath.trim())
        )
          throw new Error('Choose an absolute game folder path.');
        config.downloadPath = path.resolve(settings.downloadPath.trim());
      }
      if (typeof settings.automaticRecovery === 'boolean')
        config.automaticRecovery = settings.automaticRecovery;
      if (typeof settings.autoInstall === 'boolean') config.autoInstall = settings.autoInstall;
      if (typeof settings.cachedOnly === 'boolean') config.cachedOnly = settings.cachedOnly;
      if (typeof settings.archivePassword === 'string')
        config.archivePassword = settings.archivePassword;
      Object.assign(
        config,
        validatedFields(settings, [
          'keepArchives',
          'transferTimeoutMinutes',
          'automaticUpdates',
          'palette',
          'notifications',
          'preferredLanguage',
          'preferredRelease',
          'appearance',
        ]),
      );
    });
  }

  function saveView(view) {
    return updateConfig((config) => {
      if (view.libraryView !== undefined) {
        if (!['cards', 'list', 'banners'].includes(view.libraryView))
          throw Error('Invalid library view.');
        config.libraryView = view.libraryView;
      }
      for (const key of [
        'sidebarCollapsed',
        'libraryShowUnknown',
        'automaticGameDetection',
        'steamLibraryIntegration',
      ]) {
        if (view[key] !== undefined) {
          if (typeof view[key] !== 'boolean') throw Error('Invalid library preference.');
          config[key] = view[key];
        }
      }
      if (view.librarySort !== undefined) {
        if (!['name', 'recent', 'installed'].includes(view.librarySort))
          throw Error('Invalid library sort.');
        config.librarySort = view.librarySort;
      }
      if (view.libraryFavoritesOnly !== undefined)
        config.libraryFavoritesOnly = !!view.libraryFavoritesOnly;
      if (view.libraryAvailability !== undefined) {
        if (!['all', 'installed', 'not-installed'].includes(view.libraryAvailability))
          throw Error('Invalid library filter.');
        config.libraryAvailability = view.libraryAvailability;
      }
    });
  }

  return {
    readConfig,
    saveSettings,
    saveView,
    readLegacyTorBoxKey,
    updateConfig,
    publicConfig,
    configFile,
    getThemeStore,
    flush: () => configQueue,
  };
}
module.exports = { createConfigStore };
