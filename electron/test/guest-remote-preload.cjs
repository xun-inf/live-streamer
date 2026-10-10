const { contextBridge, ipcRenderer } = require('electron');
const remote = require('@electron/remote');

// Test the first preload execution, before page scripts run.
contextBridge.exposeInMainWorld('guestRemoteTest', {
  contentsId: remote.getCurrentWebContents().id,
  tryEnable: id => ipcRenderer.sendSync('webContents-enableRemote', id),
});
