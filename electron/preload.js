const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  gitUpdateCapable: () => ipcRenderer.invoke('watchfox:git-update-capable'),
  pullFromGithubMaster: () => ipcRenderer.invoke('watchfox:pull-github-master'),
  relaunchApp: () => ipcRenderer.invoke('watchfox:relaunch'),
});
