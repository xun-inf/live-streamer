// Preload：Renderer 只能通过这里暴露的接口访问主进程，不直接接触 Named Pipe。
// 用 .cjs 后缀是因为 package.json 是 type=module，而 preload 必须是 CommonJS。

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('meApi', {
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  onStatus: (handler) => subscribe('app:status', handler),

  // 本地窗口（第 3 层）：页面只负责量矩形，认父在主进程做
  sendViewRect: (rect) => ipcRenderer.send('video:rect', rect),
  onMeasureRequest: (handler) => subscribe('video:measure', handler),
  attachView: () => ipcRenderer.invoke('video:attach'),
  detachView: () => ipcRenderer.invoke('video:detach'),

  // 无边框窗口的自绘标题栏
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onMaximized: (handler) => subscribe('window:maximized', handler),
});
