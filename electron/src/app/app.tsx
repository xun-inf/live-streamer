import { Component, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { windowsService } from './services/windows';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('窗口初始化失败:', error); }
  render() { return this.state.failed ? <p role="alert">窗口加载失败，请重新打开。</p> : this.props.children; }
}

export function mountApp(page: ReactNode, initializeWindows = false): () => void {
  if (initializeWindows) windowsService.initialize();
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing app container');
  const root = createRoot(container);
  root.render(<ErrorBoundary><Suspense fallback={<p role="status">加载中…</p>}>
    {page}
  </Suspense></ErrorBoundary>);
  const dispose = () => {
    window.removeEventListener('unload', dispose);
    root.unmount();
    windowsService.dispose();
  };
  window.addEventListener('unload', dispose, { once: true });
  return dispose;
}
