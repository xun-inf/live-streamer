import { useLayoutEffect, useState } from 'react';
import { NativePreview } from '../../components/NativePreview';
import BrowserView from '../../components/BrowserView';
import { TitleBar } from './TitleBar';
import { windowsService } from '../../services/windows';

const { ipcRenderer } = window.require('electron');
const previewPage = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><style>
body{margin:0;padding:20px;background:#202a36;color:#e6ebf2;font:14px "Microsoft YaHei",sans-serif}
button{padding:8px 16px;cursor:pointer}p{color:#aebed0}
</style><h3>网页覆盖层</h3><p>此区域显示在原生预览上方</p>
<button onclick="this.textContent='已点击'">测试交互</button></html>`);

export function Main() {
  const [error, setError] = useState('');
  const [showBrowser, setShowBrowser] = useState(false);
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
      <button id="open-second-screen" type="button" onClick={() => run(() => windowsService.showWindow({ page: 'SecondScreen', id: 'second-screen', title: '副屏', size: { width: 960, height: 640 } }))}>打开副屏</button>
    </nav>
    {error && <p className="page-error" role="alert">{error}</p>}
    <section className="preview-panel" aria-labelledby="preview-title">
      <header className="preview-heading"><h2 id="preview-title">预览</h2>
        <button id="toggle-browser-overlay" type="button" aria-pressed={showBrowser}
          onClick={() => setShowBrowser(value => !value)}>网页覆盖层</button>
      </header>
      <NativePreview />
      {showBrowser && <BrowserView src={previewPage} className="preview-browser-overlay" />}
    </section>
  </>;
}
