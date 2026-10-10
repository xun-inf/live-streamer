import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { EventEmitter } from 'node:events';
import type { Rectangle, WebContentsView } from 'electron';
import { nativeWindowMgr } from '../shared';

const remote = window.require('@electron/remote');
// 当前 remote 的类型表未导出这两个新 API，通过 electron 模块获取。
const { BaseWindow, WebContentsView: View } = remote.require('electron') as typeof import('electron');
const { ipcRenderer } = window.require('electron');

export interface BrowserViewProps {
  src: string;
  hidden?: boolean;
  // 开启后，guest preload 可使用 @electron/remote；页面仍保持上下文隔离。
  enableGuestApi?: boolean;
  options?: Pick<Electron.WebContentsViewConstructorOptions, 'webPreferences'>;
  className?: string;
  style?: CSSProperties;
  onReady?: (view: Electron.WebContentsView) => void;
  emitUrlChange?: (url: string) => void;
  onError?: (error: Error) => void;
}

// DOM 负责占位；独立的 WebContentsView 负责在原生预览上方显示网页。
export default function BrowserView(props: BrowserViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<WebContentsView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    const owner = remote.getCurrentWindow();
    // NativeWindow 是主窗口上方的 WS_POPUP，独立的 owned window 才能覆盖它。
    const overlay = new BaseWindow({
      parent: owner, frame: false, thickFrame: false, show: false, skipTaskbar: true,
      resizable: false, minimizable: false, maximizable: false,
      hasShadow: false, width: 1, height: 1, title: 'NativeBrowserView',
    });
    const view = new View({ webPreferences: {
      ...props.options?.webPreferences,
      nodeIntegration: false, contextIsolation: true, sandbox: !props.enableGuestApi,
    } });
    const contents = view.webContents;
    overlay.contentView.addChildView(view);
    // 主进程只兜底 renderer 崩溃时的回收，并安装必须同步返回的弹窗策略。
    ipcRenderer.sendSync('remote:track-browser-view', overlay.id, contents.id);
    if (props.enableGuestApi) {
      // 必须在 onReady/loadURL 之前完成，确保 guest preload 启动时已启用 remote。
      const enabled = ipcRenderer.sendSync('webContents-enableRemote', contents.id);
      if (!enabled) {
        contents.close();
        overlay.destroy();
        throw new Error('Unable to enable remote for guest WebContents');
      }
    }
    instance.current = view;
    let disposed = false;
    let ready = false;
    let previous: Rectangle | null = null;
    const measure = () => {
      if (disposed || !host.current || owner.isDestroyed() || overlay.isDestroyed()) return;
      const rect = host.current.getBoundingClientRect();
      const style = getComputedStyle(host.current);
      if (!ready || latest.current.hidden || style.visibility === 'hidden' ||
          host.current.getClientRects().length === 0 || rect.width <= 0 || rect.height <= 0 ||
          !owner.isVisible() || owner.isMinimized()) {
        if (overlay.isVisible()) overlay.hide();
        return;
      }
      // 窗口坐标使用 DIP；CSS 像素只乘页面缩放，不乘 DPR。
      const zoom = remote.getCurrentWebContents().getZoomFactor();
      const origin = owner.getContentBounds();
      const bounds = {
        x: origin.x + Math.round(rect.x * zoom), y: origin.y + Math.round(rect.y * zoom),
        width: Math.max(1, Math.round(rect.width * zoom)), height: Math.max(1, Math.round(rect.height * zoom)),
      };
      if (!previous || bounds.x !== previous.x || bounds.y !== previous.y ||
          bounds.width !== previous.width || bounds.height !== previous.height) {
        overlay.setBounds(bounds);
        view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
        previous = bounds;
      }
      if (!overlay.isVisible()) {
        overlay.showInactive();
        overlay.moveTop();
        nativeWindowMgr.refresh();
      }
    };
    const loaded = () => { ready = true; setLoading(false); measure(); };
    const navigated = (_event: unknown, url: string) => latest.current.emitUrlChange?.(url);
    contents.on('did-finish-load', loaded);
    contents.on('did-navigate', navigated);
    contents.on('did-navigate-in-page', navigated);
    const observer = new ResizeObserver(measure);
    observer.observe(host.current!);
    // 布局位置变化不一定触发 ResizeObserver（与参考实现一致做兜底检测）。
    const timer = window.setInterval(measure, 100);
    document.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const ownerEvents = ['move', 'resize', 'show', 'hide', 'minimize', 'restore'] as const;
    for (const event of ownerEvents) (owner as EventEmitter).on(event, measure);
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      window.removeEventListener('unload', dispose);
      for (const event of ownerEvents) (owner as EventEmitter).removeListener(event, measure);
      if (!contents.isDestroyed()) {
        contents.removeListener('did-finish-load', loaded);
        contents.removeListener('did-navigate', navigated);
        contents.removeListener('did-navigate-in-page', navigated);
        contents.close();
      }
      if (!overlay.isDestroyed()) overlay.destroy();
      instance.current = null;
    };
    window.addEventListener('unload', dispose);
    latest.current.onReady?.(view);
    return dispose;
  }, [props.enableGuestApi, props.options]);

  useLayoutEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void instance.current?.webContents.loadURL(props.src).catch((reason: Error & { code?: string }) => {
      if (!active || reason.code === 'ERR_ABORTED') return;
      setLoading(false);
      setError(reason.message);
      latest.current.onError?.(reason);
    });
    return () => { active = false; };
  }, [props.src, props.enableGuestApi, props.options]);

  return <div ref={host} className={props.className} hidden={props.hidden}
    style={{ height: '100%', ...props.style }} aria-busy={loading}>
    {error ? <span role="alert">{error}</span> : loading ? <span role="status">加载中…</span> : null}
  </div>;
}
