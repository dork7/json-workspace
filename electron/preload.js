const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  launchChromeDebug: () => ipcRenderer.invoke('launch-chrome-debug'),
});
