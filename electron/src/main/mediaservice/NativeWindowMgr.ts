import type { BrowserWindow } from 'electron';
import type { EventEmitter } from 'node:events';
import type { IpcClient } from './IpcClient.js';
import { NativeWindow } from './NativeWindow.js';

export interface NativeWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
}

interface Entry {
  id: number;
  window: NativeWindow;
  rect: number[] | null;
  attached: boolean;
  visible: boolean;
}

// 所有 renderer 共享此实例；原生窗口统一挂接到主窗口，以业务名称区分。
export class NativeWindowMgr {
  #host: BrowserWindow | null = null;
  #loading = true;
  #entries = new Map<string, Entry>();
  #pendingRelease = new Set<number>();
  #nextId = 1;
  #connected = false;
  #stopped = false;

  readonly #client: IpcClient;

  constructor(client: IpcClient) { this.#client = client; }

  bindMainWindow(window: BrowserWindow): void {
    if (this.#stopped) throw new Error('Native window manager has stopped');
    if (this.#host === window) return;
    if (this.#host !== null) throw new Error('Main window already bound');
    this.#host = window;
    this.#loading = true;
    const refresh = (): void => {
      if (this.#stopped || this.#loading) return;
      for (const entry of this.#entries.values()) this.#refresh(entry);
    };
    for (const event of ['move', 'resize', 'show', 'hide', 'minimize', 'restore', 'maximize', 'unmaximize',
      'enter-full-screen', 'leave-full-screen'] as const) (window as EventEmitter).on(event, refresh);
    window.webContents.on('did-start-navigation', details => {
      if (details.isMainFrame && !details.isSameDocument) {
        this.#loading = true;
        this.releaseAll();
      }
    });
    window.webContents.on('did-finish-load', () => {
      this.#loading = false;
      refresh();
    });
    window.webContents.on('render-process-gone', () => {
      this.#loading = true;
      this.releaseAll();
    });
    window.once('closed', () => {
      this.releaseAll();
      this.#host = null;
    });
  }

  create(key: string): void {
    if (this.#stopped) return;
    this.#requireHost();
    this.#checkKey(key);
    if (this.#entries.has(key)) return;
    const id = key === 'preview' ? 0 : this.#nextId++;
    if (id > 0xffffffff) throw new Error('Native window ids exhausted');
    const window = new NativeWindow(this.#client, id);
    this.#entries.set(key, { id, window, rect: null, attached: false, visible: false });
  }

  setRect(key: string, rect: NativeWindowRect): void {
    // 退出期间 renderer 仍可能有已经排队的布局回调。
    if (this.#stopped) return;
    if (this.#isRetiringPage(key)) return;
    const entry = this.#entry(key);
    if (!rect || ![rect.x, rect.y, rect.width, rect.height, rect.dpr].every(Number.isFinite) ||
        rect.width < 0 || rect.height < 0 || rect.dpr <= 0) throw new Error('Invalid native window rect');
    const pixels = [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * rect.dpr));
    if (!pixels.every(value => value >= -2147483648 && value <= 2147483647)) {
      throw new Error('Native window rect out of range');
    }
    entry.rect = pixels;
    this.#refresh(entry);
  }

  setVisible(key: string, visible: boolean): void {
    if (this.#stopped) return;
    if (this.#isRetiringPage(key)) return;
    const entry = this.#entry(key);
    if (typeof visible !== 'boolean') throw new Error('Invalid visibility');
    entry.visible = visible;
    this.#refresh(entry);
  }

  release(key: string): void {
    this.#checkKey(key);
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#hide(entry);
    if (!entry.window.release()) {
      this.#pendingRelease.add(entry.id);
    }
    this.#entries.delete(key);
  }

  releaseAll(): void {
    for (const key of this.#entries.keys()) this.release(key);
  }

  // 新的网页弹窗显示后，将原生画面重新放回 owner 正上方、其他弹窗下方。
  refresh(): void {
    if (this.#stopped || this.#loading) return;
    for (const entry of this.#entries.values()) this.#refresh(entry);
  }

  // 返回普通数据快照，便于业务查询和诊断，不暴露协议对象。
  list(): Array<{ key: string; id: number }> {
    return [...this.#entries].map(([key, entry]) => ({ key, id: entry.id }));
  }

  connectionChanged(connected: boolean): void {
    this.#connected = connected;
    if (connected) {
      for (const id of this.#pendingRelease) {
        if (new NativeWindow(this.#client, id).release()) this.#pendingRelease.delete(id);
      }
    }
    for (const entry of this.#entries.values()) {
      entry.attached = false;
      this.#refresh(entry);
    }
  }

  stop(): void {
    this.#stopped = true;
    this.releaseAll();
  }

  #hide(entry: Entry): void {
    if (entry.attached) entry.window.detach();
    entry.attached = false;
  }

  #refresh(entry: Entry): void {
    const host = this.#host;
    if (!this.#connected || !entry.visible || !entry.rect || entry.rect[2] <= 0 || entry.rect[3] <= 0 ||
        !host || host.isDestroyed() || !host.isVisible() || host.isMinimized()) {
      this.#hide(entry);
      return;
    }
    const handle = host.getNativeWindowHandle();
    const parent = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
    // 附加对象首次 attach 才创建，先隐藏创建，再布局，最后显示。
    if (!entry.attached && !entry.window.attach(parent, false)) return;
    const [x, y, width, height] = entry.rect;
    if (!entry.window.setRect(x, y, width, height)) return;
    if (!entry.attached) entry.attached = entry.window.attach(parent, true);
  }

  #requireHost(): BrowserWindow {
    const host = this.#host;
    if (this.#stopped || !host || host.isDestroyed()) throw new Error('Main window is unavailable');
    return host;
  }

  // 导航已回收旧对象时，旧页面可能仍有一帧布局回调；新页面通过 create 重新建立对象。
  #isRetiringPage(key: string): boolean {
    this.#requireHost();
    return this.#loading && !this.#entries.has(key);
  }

  #entry(key: string): Entry {
    this.#checkKey(key);
    this.#requireHost();
    const entry = this.#entries.get(key);
    if (!entry) throw new Error('Native window has not been created: ' + key);
    return entry;
  }

  #checkKey(key: string): void {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('Invalid native window key');
  }
}
