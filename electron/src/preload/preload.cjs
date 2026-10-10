// 本地 renderer 与 preload 共用上下文；原生窗口管理器由 renderer 直接通过 remote 获取。
const { ipcRenderer } = require('electron');

function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/** @type {import('../app/types.js').DesktopApi} */
const api = {
  mediaService: {
    getStatus: () => ipcRenderer.invoke('app:getStatus'),
    onStatus: (handler) => subscribe('app:status', handler),
  },
};

window.desktop = api;
