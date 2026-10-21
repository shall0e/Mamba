const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  onMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
});

contextBridge.exposeInMainWorld('torboxSettings', {
  completeSetup: () => ipcRenderer.invoke('onboarding:complete'),
  testRestart: (firstRun) => ipcRenderer.invoke('app:test-restart', firstRun),
  loadConfig: (legacyUrls) => ipcRenderer.invoke('config:load', legacyUrls),
  saveConfig: (settings) => ipcRenderer.invoke('config:save', settings),
  importConfig: () => ipcRenderer.invoke('config:import'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  clearKey: () => ipcRenderer.invoke('torbox:clear-key'),
});

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('mamba', {
  onSearchResults: (callback) => subscribe('catalog:results', callback),
  themes: () => ipcRenderer.invoke('themes:list'),
  saveTheme: (theme) => ipcRenderer.invoke('themes:save', theme),
  deleteTheme: (id) => ipcRenderer.invoke('themes:delete', id),
  exportTheme: (theme) => ipcRenderer.invoke('themes:export', theme),
  importTheme: () => ipcRenderer.invoke('themes:import'),
  downloadOptions: () => ipcRenderer.invoke('catalog:download-options'),
  clearServiceKey: (id) => ipcRenderer.invoke('service:clear-key', id),
  details: (id) => ipcRenderer.invoke('game:details', id),
  pause: (id) => ipcRenderer.invoke('downloads:pause', id),
  stopSync: () => ipcRenderer.invoke('catalog:cancel'),
  favorite: (id, value) => ipcRenderer.invoke('library:favorite', id, value),
  saveView: (view) => ipcRenderer.invoke('config:view', view),
  importGame: () => ipcRenderer.invoke('library:import'),
  chooseLauncher: (id) => ipcRenderer.invoke('library:choose-launcher', id),
  removeGame: (id) => ipcRenderer.invoke('library:remove', id),
  scanCleanup: () => ipcRenderer.invoke('cleanup:scan'),
  removeCleanup: (scan, ids) => ipcRenderer.invoke('cleanup:remove', scan, ids),
  storage: () => ipcRenderer.invoke('storage:check'),
  activity: () => ipcRenderer.invoke('app:activity'),
  retrySetupAsAdmin: (id) => ipcRenderer.invoke('issues:setup-admin', id),
  resolveIssue: (id) => ipcRenderer.invoke('issues:resolve', id),
  reportIssue: (message) => ipcRenderer.invoke('issues:report', message),
  restartTasks: () => ipcRenderer.invoke('background:restart'),
  exportDiagnostics: () => ipcRenderer.invoke('app:export-diagnostics'),
  onIssues: (callback) => subscribe('issues:changed', callback),
  onNotice: (callback) => subscribe('app:notice', callback),
  onNavigate: (callback) => subscribe('app:navigate', callback),
  updateState: () => ipcRenderer.invoke('app:updates'),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdate: (callback) => subscribe('app:updated', callback),
  catalogStatus: () => ipcRenderer.invoke('catalog:status'),
  sync: () => ipcRenderer.invoke('catalog:sync'),
  search: (query, offset) => ipcRenderer.invoke('catalog:search', query, offset),
  resolveGame: (id) => ipcRenderer.invoke('catalog:resolve', id),
  artwork: (id) => ipcRenderer.invoke('catalog:artwork', id),
  featuredGames: () => ipcRenderer.invoke('home:featured'),
  downloadBest: (id) => ipcRenderer.invoke('downloads:best', id),
  jobs: () => ipcRenderer.invoke('downloads:list'),
  download: (id, option, game, service) =>
    ipcRenderer.invoke('downloads:start', id, option, game, service),
  cancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
  retry: (id) => ipcRenderer.invoke('downloads:retry', id),
  removeDownload: (id) => ipcRenderer.invoke('downloads:remove', id),
  clearFinished: () => ipcRenderer.invoke('downloads:clear-finished'),
  library: () => ipcRenderer.invoke('library:scan'),
  gameAction: (id, action) => ipcRenderer.invoke('library:action', id, action),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  onCatalog: (callback) => subscribe('catalog:changed', callback),
  onJobs: (callback) => subscribe('downloads:changed', callback),
  onLibrary: (callback) => subscribe('library:changed', callback),
});
