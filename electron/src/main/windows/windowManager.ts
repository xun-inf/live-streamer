import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { enableRemote } from '../remote.js';

interface RecordEntry {
  id: string;
  window: BrowserWindow;
  ready: boolean;
  showRequested: boolean;
  businessId?: string;
  occupied: boolean;
  loadVersion: number;
  loadFailed: boolean;
}
interface Request {
  method: string;
  args: unknown[];
  dispatched: boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
const methods = new Set(['showWindow', 'closeWindow', 'closeAllWindow']);

// 管理 BrowserWindow 实例、预加载窗口占用和生命周期，并转发跨窗口操作请求。
class WindowManager {
  #records = new Map<string, RecordEntry>();
  #requests = new Map<number, Request>();
  #nextRequest = 1;
  #serviceReady = false;
  #stopped = false;

  constructor() {
    ipcMain.handle('windows:request', (event, method: string, args: unknown[]) => {
      if (!this.#sender(event)) throw new Error('Unknown window');
      return this.#request(method, args);
    });
    ipcMain.on('windows:service-ready', event => {
      if (this.#sender(event)?.id !== 'main' || this.#stopped) return;
      this.#serviceReady = true;
      for (const [id, request] of this.#requests) this.#dispatch(id, request);
    });
    ipcMain.on('windows:response', (event, response) => {
      if (this.#sender(event)?.id !== 'main') return;
      const request = this.#requests.get(response?.id);
      if (!request?.dispatched) return;
      this.#requests.delete(response.id);
      clearTimeout(request.timer);
      if (response.ok) request.resolve(response.result);
      else request.reject(new Error(String(response.error)));
    });
    ipcMain.on('windows:renderer-ready', event => {
      const record = this.#sender(event);
      if (!record || this.#stopped) return;
      record.ready = true;
      if (record.showRequested) this.#show(record);
    });
  }

  register(id: string, wid: number, businessId?: string): void {
    if (this.#stopped) throw new Error('Application is shutting down');
    if (typeof id !== 'string' || !id || id.length > 256 || this.#records.has(id)) {
      throw new Error('Invalid or duplicate window ID');
    }
    const window = BrowserWindow.fromId(wid);
    if (!window || [...this.#records.values()].some(record => record.window === window)) {
      throw new Error('Invalid or duplicate BrowserWindow');
    }
    const record: RecordEntry = {
      id, window, ready: false, showRequested: false, businessId, occupied: false,
      loadVersion: 0, loadFailed: false,
    };
    this.#records.set(id, record);
    enableRemote(window);
    // 原生窗口标题由窗口管理设置，重载页面时保持不变。
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => {
      // 允许当前入口刷新（包括 Vite full reload），阻止跳转到其他页面。
      if (event.url !== window.webContents.getURL()) event.preventDefault();
    });
    window.webContents.on('did-start-navigation', details => {
      if (!details.isMainFrame || details.isSameDocument) return;
      record.ready = false;
      if (id === 'main') this.#serviceUnavailable();
    });
    window.webContents.on('render-process-gone', () => {
      record.ready = false;
      if (id === 'main') this.#serviceUnavailable();
    });
    if (id === 'child') {
      window.on('close', event => {
        if (this.#stopped) return;
        event.preventDefault();
        this.hide(id);
      });
    }
    window.once('closed', () => {
      this.#records.delete(id);
      const main = this.#records.get('main');
      if (main?.ready && !this.#stopped) main.window.webContents.send('windows:removed', id);
    });
  }

  list(): Array<{ id: string; wid: number }> {
    return [...this.#records.values()].map(({ id, window }) => ({ id, wid: window.id }));
  }

  find(businessId: string): string | null {
    return [...this.#records.values()].find(record => record.businessId === businessId &&
      (record.id !== 'child' || record.occupied))?.id ?? null;
  }

  // 先占用再异步加载；关闭后的内容可以缓存，但不再占用预加载窗口。
  claimChild(businessId: string): { reload: boolean } | null {
    if (this.#stopped) throw new Error('Application is shutting down');
    const record = this.#records.get('child');
    if (!record || record.occupied) return null;
    const reload = record.loadFailed || (record.businessId !== undefined && record.businessId !== businessId);
    record.businessId = businessId;
    record.occupied = true;
    return { reload };
  }

  load(id: string, url: string): Promise<void> {
    if (this.#stopped) throw new Error('Application is shutting down');
    const record = this.#records.get(id);
    if (!record) throw new Error('Unknown window: ' + id);
    const version = ++record.loadVersion;
    record.loadFailed = false;
    record.ready = false;
    return record.window.loadURL(url).catch(error => {
      if (this.#records.get(id) === record && record.loadVersion === version) {
        record.loadFailed = true;
        this.hide(id);
      }
      throw error;
    });
  }

  show(id: string): void {
    if (this.#stopped) throw new Error('Application is shutting down');
    const record = this.#records.get(id);
    if (!record) throw new Error('Unknown window: ' + id);
    record.showRequested = true;
    if (record.window.webContents.isCrashed()) record.window.reload();
    else if (record.ready) this.#show(record);
  }

  hide(id: string): void {
    const record = this.#records.get(id);
    if (!record) throw new Error('Unknown window: ' + id);
    record.showRequested = false;
    record.occupied = false;
    record.window.hide();
    this.#records.get('main')?.window.focus();
  }

  stop(): void {
    this.#stopped = true;
    this.#serviceUnavailable();
    for (const [id, request] of this.#requests) {
      clearTimeout(request.timer);
      request.reject(new Error('Application is shutting down'));
      this.#requests.delete(id);
    }
    for (const [id, record] of this.#records) if (id !== 'main') record.window.hide();
  }

  destroy(): void {
    for (const [id, record] of this.#records) if (id !== 'main') record.window.destroy();
  }

  #show(record: RecordEntry): void {
    record.window.show();
    if (record.window.isMinimized()) record.window.restore();
    record.window.focus();
  }

  #sender(event: IpcMainEvent | IpcMainInvokeEvent): RecordEntry | undefined {
    if (event.senderFrame !== event.sender.mainFrame) return undefined;
    return [...this.#records.values()].find(record => record.window.webContents === event.sender);
  }

  #request(method: string, args: unknown[]): Promise<unknown> {
    if (this.#stopped || !methods.has(method) || !Array.isArray(args)) return Promise.reject(new Error('Invalid window request'));
    const id = this.#nextRequest++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#requests.delete(id);
        reject(new Error('Window service request timed out'));
      }, 10000);
      const request = { method, args, resolve, reject, timer, dispatched: false };
      this.#requests.set(id, request);
      this.#dispatch(id, request);
    });
  }

  #dispatch(id: number, request: Request): void {
    if (!this.#serviceReady || request.dispatched) return;
    const main = this.#records.get('main');
    if (!main || main.window.isDestroyed()) return;
    request.dispatched = true;
    main.window.webContents.send('windows:execute', { id, method: request.method, args: request.args });
  }

  #serviceUnavailable(): void {
    this.#serviceReady = false;
    for (const [id, request] of this.#requests) {
      if (!request.dispatched) continue;
      clearTimeout(request.timer);
      request.reject(new Error('Main renderer was reloaded or closed'));
      this.#requests.delete(id);
    }
  }
}

export const windowManager = new WindowManager();
