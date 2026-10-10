import { useMediaStatus } from '../../hooks/useMediaStatus';
import { useWindowControls } from '../../hooks/useWindowControls';

export function TitleBar() {
  const status = useMediaStatus();
  const { maximized, minimize, toggleMaximize, close } = useWindowControls();
  const label = maximized ? '还原' : '最大化';
  return <header className="titlebar">
    <div className="titlebar-info">
      <span className="app-name">LIVE Streamer</span>
      <div className="connection-status" id="connection-status" role="status" title={status.message}>
        <span className={'connection-dot' + (status.connected ? ' online' : '')} id="connection-dot" aria-hidden="true" />
        <span id="connection-label">{status.message || (status.connected ? '已连接' : '未连接')}</span>
      </div>
    </div>
    <nav className="window-controls" aria-label="窗口控制">
      <button type="button" className="window-button" id="window-minimize" title="最小化" aria-label="最小化" onClick={minimize}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
      <button type="button" className="window-button" id="window-maximize" title={label} aria-label={label} aria-pressed={maximized}
        onClick={toggleMaximize}>
        <svg viewBox="0 0 12 12" aria-hidden="true">{maximized ? <>
          <rect x="2.5" y="4.5" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.5 4.5V2.5h5v5h-2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </> : <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />}</svg>
      </button>
      <button type="button" className="window-button window-button-close" id="window-close" title="关闭" aria-label="关闭" onClick={close}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </nav>
  </header>;
}
