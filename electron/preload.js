const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('openCloudElectron', {
  exportMigration: (payload) => ipcRenderer.invoke('opencloud:export-migration', payload),
  openExternal: (url) => ipcRenderer.invoke('opencloud:open-external', url)
});
