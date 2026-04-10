const { contextBridge } = require('electron');

/** Reserved for future desktop-only APIs (e.g. open file dialog). */
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
});
