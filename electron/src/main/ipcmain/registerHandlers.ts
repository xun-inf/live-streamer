import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import { IPC_CHANNELS } from './channels.js';
import type { MediaService } from '../mediaservice/index.js';
import { mainWindow } from '../windows/mainWindow.js';
import { windowManager } from '../windows/windowManager.js';

export function registerHandlers(
  service: MediaService,
  secondScreenUrl: string,
): () => void {
  const requireSender = (event: IpcMainInvokeEvent): void => {
    if (!mainWindow.accepts(event)) throw new Error('Unknown renderer');
  };
  const requirePreviewSender = (event: IpcMainInvokeEvent): void => {
    if (mainWindow.accepts(event)) return;
    const actual = new URL(event.sender.getURL());
    const expected = new URL(secondScreenUrl);
    if (event.senderFrame !== event.sender.mainFrame ||
        actual.origin !== expected.origin || actual.pathname !== expected.pathname ||
        !windowManager.list().some(item => BrowserWindow.fromId(item.wid)?.webContents === event.sender)) {
      throw new Error('Unknown preview renderer');
    }
  };
  ipcMain.handle(IPC_CHANNELS.getStatus, (event) => {
    requireSender(event);
    return service.status;
  });
  ipcMain.handle(IPC_CHANNELS.streamPreviewBind, async (event, id: number) => {
    requirePreviewSender(event);
    const frame = event.senderFrame;
    if (!(await service.ensureConnected())) throw new Error('Media service unavailable');
    requirePreviewSender(event);
    if (frame !== event.senderFrame || !frame || frame.detached) throw new Error('Renderer changed');
    service.streamPreview.bind(id, event.sender);
  });
  ipcMain.handle(IPC_CHANNELS.streamPreviewUnbind, (event, id: number) => {
    requirePreviewSender(event);
    service.streamPreview.unbind(id, event.sender);
  });
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.getStatus);
    ipcMain.removeHandler(IPC_CHANNELS.streamPreviewBind);
    ipcMain.removeHandler(IPC_CHANNELS.streamPreviewUnbind);
  };
}
