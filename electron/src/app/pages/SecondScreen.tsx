import { useLayoutEffect, useState } from 'react';
import { useWindowControls } from '../hooks/useWindowControls';
import { StreamPreview } from '../components/StreamPreview';

const { ipcRenderer } = window.require('electron');
const streamId = Number(new URLSearchParams(location.search).get('streamId') ?? 0);

export function SecondScreen() {
  const { close, toggleMaximize } = useWindowControls();
  const [hasFrame, setHasFrame] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => { ipcRenderer.send('windows:renderer-ready'); }, []);
  return <>
    <header className="business-toolbar" onDoubleClick={toggleMaximize}>
      <strong id="business-title">副屏</strong>
      <button id="business-close" type="button" onClick={close}>关闭</button>
    </header>
    <section className="second-screen">
      {error ? <p className="page-error" role="alert">{error}</p> :
        !hasFrame && <p role="status">等待视频画面…</p>}
      <div className="second-screen-canvas">
        <StreamPreview streamId={streamId} aria-label="副屏视频画面"
          onFrame={() => setHasFrame(true)} onError={error => setError(error.message)} />
      </div>
    </section>
  </>;
}
