const { ipcRenderer, contextBridge } = require('electron');

// Nothing exposed to renderer for now; Electron handles blocking in main process
// The renderer has no special privileges — it runs as a normal web app
