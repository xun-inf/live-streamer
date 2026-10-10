import remoteMain from '@electron/remote/main/index.js';
import { BaseWindow, BrowserWindow, ipcMain, WebContentsView } from 'electron';

export function initializeRemote(): void {
  remoteMain.initialize();
  const guests = new Map<number, { owner: Electron.WebContents; contents: Electron.WebContents }>();
  ipcMain.on('webContents-enableRemote', (event, id: number) => {
    // 所有分支都设置 returnValue，sendSync 才不会挂起。
    const guest = guests.get(id);
    if (!guest || guest.owner !== event.sender || event.senderFrame !== event.sender.mainFrame ||
        guest.contents.isDestroyed()) {
      event.returnValue = false;
      return;
    }
    let enabled = false;
    try {
      remoteMain.enable(guest.contents);
      enabled = true;
    } finally {
      event.returnValue = enabled;
    }
  });
  // 正常生命周期由 renderer 管理；崩溃时 unload 不会执行，兜底关闭其视图。
  ipcMain.on('remote:track-browser-view', (event, windowId: number, contentsId: number) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const overlay = BaseWindow.fromId(windowId);
    if (!owner || event.senderFrame !== event.sender.mainFrame ||
        !overlay || overlay.getParentWindow() !== owner) {
      event.returnValue = false;
      return;
    }
    const view = overlay.contentView.children.find(child =>
      child instanceof WebContentsView && child.webContents.id === contentsId) as WebContentsView | undefined;
    if (!view) {
      event.returnValue = false;
      return;
    }
    const contents = view.webContents;
    if (guests.has(contents.id)) {
      event.returnValue = true;
      return;
    }
    const contentsIdKey = contents.id;
    guests.set(contentsIdKey, { owner: event.sender, contents });
    contents.once('destroyed', () => guests.delete(contentsIdKey));
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const destroy = () => {
      if (!contents.isDestroyed()) contents.close();
      if (!overlay.isDestroyed()) overlay.destroy();
    };
    event.sender.once('render-process-gone', destroy);
    event.sender.once('destroyed', destroy);
    overlay.once('closed', () => {
      event.sender.removeListener('render-process-gone', destroy);
      event.sender.removeListener('destroyed', destroy);
      if (!contents.isDestroyed()) contents.close();
    });
    event.returnValue = true;
  });
}
export function enableRemote(window: BrowserWindow): void {
  remoteMain.enable(window.webContents);
}
