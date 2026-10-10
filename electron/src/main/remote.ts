import remoteMain from '@electron/remote/main/index.js';
import type { BrowserWindow } from 'electron';

export function initializeRemote(): void {
  remoteMain.initialize();
}
export function enableRemote(window: BrowserWindow): void {
  remoteMain.enable(window.webContents);
}
