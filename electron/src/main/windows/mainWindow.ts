import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import type { AppPaths } from '../appPaths.js';
import { logger } from '../logger.js';
import { mediaService } from '../mediaService/index.js';
import { IPC_CHANNELS } from '../ipc/channels.js';
import { windowManager } from './windowManager.js';

interface MainWindowOptions {
  paths: AppPaths;
  sourceDir: string;
  pageUrl: string;
  devtoolsEnabled: boolean;
  canClose(): boolean;
  onClose(): void;
}

class MainWindow {
  private window: BrowserWindow | null = null;
  private rendererReady = false;
  private stopping = false;
  private unsubscribeStatus: (() => void) | null = null;

  private initialization: MainWindowOptions | null = null;

  initialize(options: MainWindowOptions): void {
    if (this.initialization !== null) throw new Error('MainWindow is already initialized');
    this.initialization = { ...options, paths: { ...options.paths } };
  }

  private get options(): MainWindowOptions {
    if (this.initialization === null) throw new Error('MainWindow must be initialized before use');
    return this.initialization;
  }

  get target(): BrowserWindow | null {
    return this.window !== null && !this.window.isDestroyed() ? this.window : null;
  }

  get ready(): boolean {
    return this.rendererReady && this.target !== null;
  }

  create(): void {
    if (this.stopping) throw new Error('MainWindow has been stopped');
    if (this.target !== null) return;
    const { paths, sourceDir } = this.options;
    const iconPath = path.join(paths.configDir, 'app.ico');
    const target = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 640,
      minHeight: 400,
      frame: false,
      show: false,
      title: 'LIVE Streamer',
      backgroundColor: '#0f141a',
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        preload: path.join(sourceDir, 'preload', 'preload.cjs'),
        contextIsolation: false,
        nodeIntegration: true,
        sandbox: false,
      },
    });
    this.window = target;
    windowManager.register('main', target.id);
    mediaService.nativeWindowMgr.bindMainWindow(target);
    this.unsubscribeStatus = mediaService.onStatus(status => {
      if (!this.stopping) this.send(IPC_CHANNELS.status, status);
    });
    target.once('ready-to-show', () => {
      if (!target.isDestroyed()) target.show();
    });
    target.on('close', (event) => {
      if (this.options.canClose()) return;
      event.preventDefault();
      this.options.onClose();
    });
    target.on('closed', () => {
      this.stop();
      this.window = null;
    });

    target.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.markRendererUnavailable();
    });
    target.webContents.on('render-process-gone', (_event, details) => {
      logger.error('renderer gone: ' + details.reason);
      this.markRendererUnavailable();
    });
    target.webContents.on('console-message', (details) => {
      const message = 'renderer: ' + details.message;
      switch (details.level) {
        case 'error': logger.error(message); break;
        case 'warning': logger.warning(message); break;
        case 'debug': logger.debug(message); break;
        default: logger.info(message);
      }
    });
    target.webContents.on('did-finish-load', () => {
      if (this.stopping) return;
      this.rendererReady = true;
      this.onRendererReady();
    });
    target.webContents.on('before-input-event', (event, input) => {
      if (!this.options.devtoolsEnabled || input.type !== 'keyDown') return;
      const inspect = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
      if (input.key !== 'F12' && !inspect) return;
      event.preventDefault();
      if (target.webContents.isDevToolsOpened()) {
        target.webContents.closeDevTools();
      } else {
        target.webContents.openDevTools({ mode: 'detach' });
      }
    });
    const url = new URL(this.options.pageUrl);
    url.searchParams.set('id', 'main');
    target.loadURL(url.href).catch((error: unknown) => {
      logger.error('renderer load failed:', error);
      this.markRendererUnavailable();
    });
    if (this.options.devtoolsEnabled) target.webContents.openDevTools({ mode: 'detach' });
  }

  stop(): void {
    this.stopping = true;
    this.markRendererUnavailable();
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
  }

  private async onRendererReady(): Promise<void> {
    if (this.stopping) return;
    this.send(IPC_CHANNELS.status, mediaService.status);
    try {
      await mediaService.ensureConnected();
    } catch (error) {
      logger.error('media-service connection failed:', error);
    }
  }

  accepts(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const target = this.target;
    return target !== null && event.sender === target.webContents &&
      event.senderFrame === target.webContents.mainFrame;
  }

  send(channel: string, payload?: unknown): boolean {
    const target = this.target;
    if (target === null || !this.rendererReady) return false;
    try {
      target.webContents.send(channel, payload);
      return true;
    } catch (error) {
      logger.error('send to renderer failed:', error);
      this.markRendererUnavailable();
      return false;
    }
  }

  private markRendererUnavailable(): void {
    this.rendererReady = false;
  }
}

export const mainWindow = new MainWindow();
