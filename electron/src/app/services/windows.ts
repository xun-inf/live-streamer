import type { BrowserWindow, IpcRendererEvent, Rectangle } from 'electron';
import type { ResolvedWindowOptions, WindowConfig, WindowOptions, WindowManagerApi } from '../types';

const remote = window.require('@electron/remote');
const { ipcRenderer } = window.require('electron');
const { randomUUID } = window.require('node:crypto');
const windowManager = remote.getGlobal('windowManager') as WindowManagerApi;
const config = remote.getGlobal('windowConfig') as WindowConfig;
const ownId = new URLSearchParams(location.search).get('id');
const methods = new Set(['showWindow', 'closeWindow', 'closeAllWindow']);

// 只有 main renderer 执行管理逻辑；其他 renderer 的同名入口通过 IPC 请求它。
export class WindowsService {
  #windows = new Map<string, BrowserWindow>();
  #initialized = false;
  #cleanup: (() => void) | null = null;

  initialize() {
    if (ownId !== 'main' || this.#initialized) return;
    this.#initialized = true;
    for (const state of windowManager.list()) {
      const window = remote.BrowserWindow.fromId(state.wid);
      if (window) this.#windows.set(state.id, window);
    }
    const execute = async (_event: IpcRendererEvent, request: { id: number; method: string; args: unknown[] }) => {
      try {
        if (!methods.has(request.method)) throw new Error('Unknown window operation');
        const result = await this.#execute(request.method, request.args);
        ipcRenderer.send('windows:response', { id: request.id, ok: true, result });
      } catch (error) {
        ipcRenderer.send('windows:response', { id: request.id, ok: false, error: String(error) });
      }
    };
    const removed = (_event: IpcRendererEvent, id: string) => { this.#windows.delete(id); };
    ipcRenderer.on('windows:execute', execute);
    ipcRenderer.on('windows:removed', removed);
    this.#cleanup = () => {
      ipcRenderer.removeListener('windows:execute', execute);
      ipcRenderer.removeListener('windows:removed', removed);
    };
    ipcRenderer.send('windows:service-ready');
  }

  dispose() {
    this.#cleanup?.();
    this.#cleanup = null;
    this.#initialized = false;
    this.#windows.clear();
  }

  showWindow(options: WindowOptions) { return this.#call('showWindow', [options]); }
  closeWindow(id: string) { return this.#call('closeWindow', [id]); }
  closeAllWindow() { return this.#call('closeAllWindow', []); }

  #call(method: 'showWindow', args: unknown[]): Promise<string>;
  #call(method: 'closeWindow' | 'closeAllWindow', args: unknown[]): Promise<void>;
  #call(method: string, args: unknown[]): Promise<string | void> {
    if (ownId !== 'main') return ipcRenderer.invoke('windows:request', method, args);
    return Promise.resolve().then(() => this.#execute(method, args));
  }

  #execute(method: string, args: unknown[]): string | void | Promise<string> {
    switch (method) {
      case 'showWindow': return this.#showWindow(args[0]);
      case 'closeWindow': return this.#closeWindow(args[0]);
      case 'closeAllWindow':
        for (const state of windowManager.list()) {
          if (state.id !== 'main') this.#closeWindow(state.id);
        }
        return;
      default: throw new Error('Unknown window operation');
    }
  }

  #showWindow(value: unknown): string | Promise<string> {
    const options = this.#options(value);
    const businessId = options.id ?? (options.reuse ? 'page:' + options.page : randomUUID());
    const existing = windowManager.find(businessId);
    if (existing !== null) {
      windowManager.show(existing);
      return existing;
    }
    const claim = options.reuse ? windowManager.claimChild(businessId) : null;
    if (!claim) return this.#createOneOff(options, businessId);
    const child = this.#window('child');
    try {
      this.#layout(child, options);
      const url = new URL(config.pageUrls[options.page]);
      url.searchParams.set('id', 'child');
      if (claim.reload || child.webContents.getURL() !== url.href) {
        const loaded = windowManager.load('child', url.href);
        windowManager.show('child');
        return loaded.then(() => 'child');
      }
      windowManager.show('child');
      return 'child';
    } catch (error) {
      windowManager.hide('child');
      throw error;
    }
  }

  #createOneOff(options: ResolvedWindowOptions, id: string): Promise<string> {
    const window = new remote.BrowserWindow({
      parent: this.#window('main'), frame: false, skipTaskbar: true,
      width: options.size.width, height: options.size.height,
      minWidth: options.size.minWidth ?? 320, minHeight: options.size.minHeight ?? 240,
      show: false, backgroundColor: '#0f141a',
      webPreferences: { preload: config.preload, nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    window.setMenu(null);
    try {
      windowManager.register(id, window.id, id);
      this.#windows.set(id, window);
      windowManager.show(id);
      this.#layout(window, options);
      const url = new URL(config.pageUrls[options.page]);
      url.searchParams.set('id', id);
      // 等待加载结果，加载失败时清理已经登记的窗口。
      return window.loadURL(url.href).then(() => id, error => {
        if (!window.isDestroyed()) window.destroy();
        throw error;
      });
    } catch (error) {
      window.destroy();
      throw error;
    }
  }

  #closeWindow(id: unknown): void {
    if (typeof id !== 'string' || !id || id === 'main') throw new Error('Invalid business window ID');
    const windowId = windowManager.find(id) ?? id;
    if (windowId === 'child') {
      windowManager.hide(windowId);
      return;
    }
    const state = windowManager.list().find(state => state.id === windowId);
    if (!state) return;
    remote.BrowserWindow.fromId(state.wid)?.destroy();
    this.#windows.delete(windowId);
  }

  #window(id: string): BrowserWindow {
    const window = this.#windows.get(id);
    if (!window || window.isDestroyed()) throw new Error('Window unavailable: ' + id);
    return window;
  }

  #options(value: unknown): ResolvedWindowOptions {
    if (!value || typeof value !== 'object' || !('page' in value) ||
        typeof value.page !== 'string' ||
        !Object.prototype.hasOwnProperty.call(config.pageUrls, value.page)) {
      throw new Error('Unknown window page');
    }
    const options = JSON.parse(JSON.stringify(value)) as WindowOptions;
    if (options.reuse !== undefined && typeof options.reuse !== 'boolean') throw new Error('Invalid reuse option');
    if (options.id !== undefined && (typeof options.id !== 'string' || !options.id ||
        options.id.length > 256 || ['main', 'child'].includes(options.id))) throw new Error('Invalid business window ID');
    options.size ??= { width: 800, height: 600 };
    for (const key of ['width', 'height', 'minWidth', 'minHeight'] as const) {
      const size = options.size[key];
      if (size !== undefined && (!Number.isInteger(size) || size <= 0 || size > 16384)) throw new Error('Invalid window size');
    }
    if (!options.size.width || !options.size.height) throw new Error('Window size is incomplete');
    return { ...options, size: options.size };
  }

  #layout(window: BrowserWindow, options: ResolvedWindowOptions): void {
    const bounds = this.#window('main').getBounds();
    const display = remote.screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(options.size.width, display.width);
    const height = Math.min(options.size.height, display.height);
    window.setMinimumSize(Math.min(options.size.minWidth ?? 320, width), Math.min(options.size.minHeight ?? 240, height));
    const next: Partial<Rectangle> = { width, height };
    if (options.center !== false) {
      next.x = Math.max(display.x, Math.min(Math.round(bounds.x + (bounds.width - width) / 2), display.x + display.width - width));
      next.y = Math.max(display.y, Math.min(Math.round(bounds.y + (bounds.height - height) / 2), display.y + display.height - height));
    }
    window.setBounds(next);
    window.setTitle(options.title || options.page);
  }
}

export const windowsService = new WindowsService();
