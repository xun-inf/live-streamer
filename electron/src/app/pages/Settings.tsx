import { useLayoutEffect, useState } from 'react';
import { useWindowControls } from '../hooks/useWindowControls';

const { ipcRenderer } = window.require('electron');

const groups = [
  { id: 'general', title: '通用', description: '应用的基础偏好。' },
  { id: 'stream', title: '直播', description: '直播连接与输出设置。' },
  { id: 'video', title: '视频', description: '画面尺寸、帧率与视频质量。' },
  { id: 'audio', title: '音频', description: '音频设备与声音输出。' },
] as const;
type GroupId = typeof groups[number]['id'];

export function Settings() {
  const { close } = useWindowControls();
  useLayoutEffect(() => { ipcRenderer.send('windows:renderer-ready'); }, []);
  const [active, setActive] = useState<GroupId>('general');
  const group = groups.find(item => item.id === active) ?? groups[0];
  return <>
    <header className="business-toolbar">
      <strong id="business-title">设置</strong>
      <button id="business-close" type="button" onClick={close}>关闭</button>
    </header>
    <div className="settings-page">
    <nav className="settings-navigation" aria-label="设置分组">
      {groups.map(item => <button key={item.id} type="button" data-group={item.id}
        aria-pressed={active === item.id} aria-controls="settings-content" onClick={() => setActive(item.id)}>
        {item.title}
      </button>)}
    </nav>
    <section className="settings-content" id="settings-content" aria-labelledby="settings-group-title">
      <h1 id="settings-group-title">{group.title}</h1>
      <p className="settings-description">{group.description}</p>
      <div className="settings-empty">暂无设置项</div>
    </section>
    </div>
  </>;
}
