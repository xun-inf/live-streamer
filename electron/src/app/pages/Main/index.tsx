import { useLayoutEffect, useState } from 'react';
import { NativePreview } from '../../components/NativePreview';
import { TitleBar } from './TitleBar';
import { windowsService } from '../../services/windows';

const { ipcRenderer } = window.require('electron');

export function Main() {
  const [error, setError] = useState('');
  const run = (task: () => Promise<unknown>) => {
    setError('');
    task().catch(error => { setError(String(error)); console.error('打开窗口失败:', error); });
  };
  useLayoutEffect(() => { ipcRenderer.send('windows:renderer-ready'); }, []);
  return <>
    <TitleBar />
    <nav className="main-toolbar" aria-label="主页面">
      <div>
        <h1>直播工作台</h1>
        <p>管理预览与直播设置</p>
      </div>
      <button id="open-settings" type="button" onClick={() => run(() => windowsService.showWindow({ page: 'Settings', reuse: true, title: '设置', size: { width: 900, height: 680 } }))}>设置</button>
    </nav>
    {error && <p className="page-error" role="alert">{error}</p>}
    <section className="preview-panel" aria-labelledby="preview-title">
      <header className="preview-heading"><h2 id="preview-title">预览</h2></header>
      <NativePreview />
    </section>
  </>;
}
