const path = require('node:path');
const palette = require('../shared/palette-defaults.json');
function validateSettings(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw Error('Settings must be a JSON object.');
  const visit = (item) => {
    if (item && typeof item === 'object')
      for (const key of Object.keys(item)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw Error('Invalid settings key.');
        visit(item[key]);
      }
  };
  visit(value);
  const copy = JSON.parse(JSON.stringify(value));
  if (copy.libraryState !== undefined) {
    const state = copy.libraryState;
    const object = (item) => item && typeof item === 'object' && !Array.isArray(item);
    if (
      !object(state) ||
      !object(state.games) ||
      !Array.isArray(state.imports) ||
      state.imports.some((folder) => typeof folder !== 'string' || !path.isAbsolute(folder)) ||
      (state.remembered !== undefined && !object(state.remembered)) ||
      (state.hidden !== undefined && !object(state.hidden))
    )
      throw Error('Invalid library export.');
    for (const preferences of Object.values(state.games)) {
      if (
        !object(preferences) ||
        Object.keys(preferences).some((key) => !['favorite', 'lastPlayed'].includes(key)) ||
        (preferences.favorite !== undefined && typeof preferences.favorite !== 'boolean') ||
        (preferences.lastPlayed !== undefined &&
          (typeof preferences.lastPlayed !== 'string' ||
            !Number.isFinite(Date.parse(preferences.lastPlayed))))
      )
        throw Error('Invalid library preferences.');
    }
    if (Object.values(state.hidden || {}).some((value) => typeof value !== 'boolean'))
      throw Error('Invalid hidden library entries.');
    for (const game of Object.values(state.remembered || {})) {
      if (
        !object(game) ||
        typeof game.id !== 'string' ||
        typeof game.name !== 'string' ||
        (game.folder != null &&
          (typeof game.folder !== 'string' || !path.isAbsolute(game.folder))) ||
        (game.installations !== undefined &&
          (!Array.isArray(game.installations) ||
            game.installations.some(
              (item) =>
                !object(item) || typeof item.folder !== 'string' || !path.isAbsolute(item.folder),
            )))
      )
        throw Error('Invalid remembered game.');
    }
    copy.libraryState = {
      games: state.games,
      imports: state.imports,
      remembered: state.remembered || {},
      hidden: state.hidden || {},
    };
  }
  if (copy.appearance !== undefined)
    copy.appearance = require('../shared/theme-model.js').parse(copy.appearance);
  if (
    copy.enabledDownloadServices !== undefined &&
    (!Array.isArray(copy.enabledDownloadServices) ||
      copy.enabledDownloadServices.some((id) => !['torbox', 'realdebrid', 'direct'].includes(id)))
  )
    throw Error('Choose supported download services.');
  if (
    copy.preferredDownloadService !== undefined &&
    !['auto', 'torbox', 'realdebrid', 'direct'].includes(copy.preferredDownloadService)
  )
    throw Error('Choose a supported default download service.');
  if (
    copy.disabledDownloadHosts !== undefined &&
    (!Array.isArray(copy.disabledDownloadHosts) ||
      copy.disabledDownloadHosts.some(
        (host) => typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host),
      ))
  )
    throw Error('Invalid download host selection.');
  if (
    copy.disabledSourceUrls !== undefined &&
    (!Array.isArray(copy.disabledSourceUrls) ||
      copy.disabledSourceUrls.some((uri) => {
        try {
          return !['https:', 'http:'].includes(new URL(uri).protocol);
        } catch {
          return true;
        }
      }))
  )
    throw Error('Invalid source selection.');
  for (const key of [
    'autoInstall',
    'automaticRecovery',
    'cachedOnly',
    'keepArchives',
    'automaticUpdates',
    'notifications',
    'libraryShowUnknown',
    'automaticGameDetection',
    'steamLibraryIntegration',
  ])
    if (copy[key] !== undefined && typeof copy[key] !== 'boolean')
      throw Error(key + ' must be true or false.');
  if (
    copy.preferredLanguage !== undefined &&
    !['any', 'english', 'russian', 'spanish', 'french', 'german'].includes(copy.preferredLanguage)
  )
    throw Error('Choose a supported preferred language.');
  if (
    copy.preferredRelease !== undefined &&
    !['any', 'repack', 'portable', 'original'].includes(copy.preferredRelease)
  )
    throw Error('Choose a supported release type.');
  if (copy.libraryView !== undefined && !['cards', 'list', 'banners'].includes(copy.libraryView))
    throw Error('Invalid library view.');
  if (copy.librarySort !== undefined && !['name', 'recent', 'installed'].includes(copy.librarySort))
    throw Error('Invalid library sort.');
  if (copy.libraryFavoritesOnly !== undefined && typeof copy.libraryFavoritesOnly !== 'boolean')
    throw Error('Invalid favorites filter.');
  if (
    copy.libraryAvailability !== undefined &&
    !['all', 'installed', 'not-installed'].includes(copy.libraryAvailability)
  )
    throw Error('Invalid library filter.');
  for (const key of ['torboxApiKey', 'realDebridApiKey', 'archivePassword'])
    if (copy[key] !== undefined && typeof copy[key] !== 'string')
      throw Error(key + ' must be text.');
  if (copy.extraGameFolders !== undefined)
    copy.extraGameFolders = require('./library-folders.cjs').normalizeFolders(
      copy.extraGameFolders,
    );
  if (
    copy.downloadPath !== undefined &&
    (typeof copy.downloadPath !== 'string' ||
      (!path.isAbsolute(copy.downloadPath) && !path.win32.isAbsolute(copy.downloadPath)))
  )
    throw Error('Choose an absolute games folder path.');
  if (
    copy.transferTimeoutMinutes !== undefined &&
    (!Number.isFinite(copy.transferTimeoutMinutes) ||
      copy.transferTimeoutMinutes < 5 ||
      copy.transferTimeoutMinutes > 1440)
  )
    throw Error('Preparation timeout must be between 5 and 1440 minutes.');
  if (copy.sourceUrls !== undefined) {
    if (!Array.isArray(copy.sourceUrls)) throw Error('Sources must be a list.');
    copy.sourceUrls = [
      ...new Set(
        copy.sourceUrls.map((url) => {
          if (typeof url !== 'string' || !['https:', 'http:'].includes(new URL(url).protocol))
            throw Error('Invalid source URL.');
          return url.trim();
        }),
      ),
    ];
  }
  if (copy.palette !== undefined) {
    if (!copy.palette || Array.isArray(copy.palette) || typeof copy.palette !== 'object')
      throw Error('Invalid palette.');
    for (const [key, color] of Object.entries(copy.palette))
      if (!(key in palette) || typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))
        throw Error('Palette colors must use #RRGGBB.');
  }
  return copy;
}
function decodeConfig(text) {
  const data = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (data?.schemaVersion !== undefined && data.schemaVersion !== 1)
    throw Error('This config export uses an unsupported version.');
  return validateSettings(data?.schemaVersion === 1 ? data.settings : data);
}
const encodeConfig = (settings, version) =>
  JSON.stringify(
    { schemaVersion: 1, appVersion: version, exportedAt: new Date().toISOString(), settings },
    null,
    2,
  ) + '\n';
module.exports = { validateSettings, decodeConfig, encodeConfig };
