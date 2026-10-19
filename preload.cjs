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
  }
});

contextBridge.exposeInMainWorld('torboxSettings', {
  loadConfig: (legacyUrls) => ipcRenderer.invoke('config:load', legacyUrls),
  saveConfig: (settings) => ipcRenderer.invoke('config:save', settings),
  clearKey: () => ipcRenderer.invoke('torbox:clear-key')
});

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('mamba', {
  catalogStatus: () => ipcRenderer.invoke('catalog:status'),
  sync: () => ipcRenderer.invoke('catalog:sync'),
  search: (query, offset) => ipcRenderer.invoke('catalog:search', query, offset),
  resolveGame: (id) => ipcRenderer.invoke('catalog:resolve', id),
  artwork: (id) => ipcRenderer.invoke('catalog:artwork', id),
  downloadBest: (id) => ipcRenderer.invoke('downloads:best', id),
  jobs: () => ipcRenderer.invoke('downloads:list'),
  download: (id, option) => ipcRenderer.invoke('downloads:start', id, option),
  cancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
  retry: (id) => ipcRenderer.invoke('downloads:retry', id),
  removeDownload: (id) => ipcRenderer.invoke('downloads:remove', id),
  clearFinished: () => ipcRenderer.invoke('downloads:clear-finished'),
  library: () => ipcRenderer.invoke('library:scan'),
  gameAction: (id, action) => ipcRenderer.invoke('library:action', id, action),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  onCatalog: (callback) => subscribe('catalog:changed', callback),
  onJobs: (callback) => subscribe('downloads:changed', callback),
  onLibrary: (callback) => subscribe('library:changed', callback)
});
