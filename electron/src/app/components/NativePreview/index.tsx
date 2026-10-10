import { useLayoutEffect, useRef } from 'react';
import { nativeWindowMgr } from '../../shared';
import { observeNativeWindow, type NativeWindowLayout } from './nativeWindow';

// 仅主窗口使用；layoutKey 改变时可主动同步仅位置变化的业务布局。
export function NativePreview({ name = 'preview', visible = true, layoutKey }: { name?: string; visible?: boolean; layoutKey?: string | number }) {
  const host = useRef<HTMLElement>(null);
  const layout = useRef<NativeWindowLayout | null>(null);
  useLayoutEffect(() => {
    if (!host.current) return;
    nativeWindowMgr.create(name);
    layout.current = observeNativeWindow(host.current, {
      setRect: rect => nativeWindowMgr.setRect(name, rect),
    });
    return () => {
      layout.current?.dispose();
      layout.current = null;
      nativeWindowMgr.release(name);
    };
  }, [name]);
  useLayoutEffect(() => {
    nativeWindowMgr.setVisible(name, visible);
    layout.current?.requestMeasure();
  }, [name, visible, layoutKey]);
  return <main ref={host} className="native-window-host" id="native-window-host" hidden={!visible} aria-label="原生画面区域" />;
}
