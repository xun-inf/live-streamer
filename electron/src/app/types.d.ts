export type PageName = 'Settings' | 'SecondScreen';

// 页面使用的宿主能力声明，独立于主进程实现和外部源码目录。
export interface AppStatus {
  connected: boolean;
  message: string;
}

// 页面提交 CSS 像素矩形；原生窗口 id 和物理像素转换由主进程管理。
export interface NativeWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
}

export type Unsubscribe = () => void;
export type StreamPreviewSubscribe = (id: number, consume: (frame: VideoFrame) => void) => Promise<() => Promise<void>>;

export interface DesktopApi {
  mediaService: {
    getStatus(): Promise<AppStatus>;
    onStatus(handler: (status: AppStatus) => void): Unsubscribe;
  };
}

export interface NativeWindowMgrApi {
  refresh(): void;
  create(key: string): void;
  setRect(key: string, rect: NativeWindowRect): void;
  setVisible(key: string, visible: boolean): void;
  release(key: string): void;
  list(): Array<{ key: string; id: number }>;
}

export interface WindowOptions {
  page: PageName;
  // true 优先使用空闲预加载窗口，忙时回退 OneOff；默认 false。
  reuse?: boolean;
  // 同一业务窗口的标识；reuse 为 true 时默认按页面名识别。
  id?: string;
  queryParams?: Record<string, unknown>;
  title?: string;
  size?: { width: number; height: number; minWidth?: number; minHeight?: number };
  center?: boolean;
}

export type ResolvedWindowOptions = WindowOptions & { size: NonNullable<WindowOptions['size']> };
export interface WindowManagerApi {
  list(): Array<{ id: string; wid: number }>;
  register(id: string, wid: number, businessId?: string): void;
  find(businessId: string): string | null;
  claimChild(businessId: string): { reload: boolean } | null;
  load(id: string, url: string): Promise<void>;
  show(id: string): void;
  hide(id: string): void;
}
export interface WindowConfig { pageUrls: Record<PageName, string>; preload: string }

declare global {
  interface Window {
    streamPreview: {
      subscribe: StreamPreviewSubscribe;
    };
    desktop: DesktopApi;
    require(name: '@electron/remote'): typeof import('@electron/remote');
    require(name: 'electron'): typeof import('electron');
    require(name: 'node:crypto'): typeof import('node:crypto');
  }
}
