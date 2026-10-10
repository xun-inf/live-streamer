import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import { IPC_CHANNELS } from './channels.js';
import type { MediaService } from '../mediaService/index.js';
import { mainWindow } from '../windows/mainWindow.js';

export function registerHandlers(
  service: MediaService,
): () => void {
  const requireSender = (event: IpcMainInvokeEvent): void => {
    if (!mainWindow.accepts(event)) throw new Error('Unknown renderer');
  };
  ipcMain.handle(IPC_CHANNELS.getStatus, (event) => {
    requireSender(event);
    return service.status;
  });
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.getStatus);
  };
}
