// Renderer：只通过 preload 暴露的 meApi 工作，不接触 Node / Named Pipe。
// 本地窗口（第 3 层）是真窗口，DOM 盖不住它：页面只负责量出画面区域的矩形，
// 主进程换算成物理像素后推给 engine 摆位。

const api = window.meApi;

const ui = {
  version: document.getElementById('app-version'),
  connDot: document.getElementById('conn-dot'),
  videoHost: document.getElementById('video-host'),
  roomTitle: document.getElementById('room-title'),
  btnMinimize: document.getElementById('btn-minimize'),
  btnMaximize: document.getElementById('btn-maximize'),
  btnClose: document.getElementById('btn-close'),
  micVolume: document.getElementById('mic-volume'),
  micValue: document.getElementById('mic-value'),
  speakerVolume: document.getElementById('speaker-volume'),
  speakerValue: document.getElementById('speaker-value'),
  btnLive: document.getElementById('btn-live'),
  btnLiveText: document.getElementById('btn-live-text'),
  btnBack: document.getElementById('btn-back'),
  btnAddMaterial: document.getElementById('btn-add-material'),
  btnClearMaterial: document.getElementById('btn-clear-material'),
  btnAudioSettings: document.getElementById('btn-audio-settings'),
  btnNotifications: document.getElementById('btn-notifications'),
  btnSettings: document.getElementById('btn-settings'),
};

function logLine(text) {
  console.log('[ui] ' + text);
}

/* ---------------- 连接状态（标题栏小圆点） ---------------- */

function setConnected(connected, message) {
  ui.connDot.classList.toggle('online', connected);
  ui.connDot.title = message;
}

/* ---------------- 本地窗口矩形 ---------------- */

function measureVideoHost() {
  const rect = ui.videoHost.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  api.sendViewRect({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    dpr: window.devicePixelRatio || 1,
  });
}

// 窗口 move / resize 这类事件只有主进程知道：它让我们重新量一次
api.onMeasureRequest(() => measureVideoHost());
window.addEventListener('resize', measureVideoHost);
document.addEventListener('scroll', measureVideoHost, true);
new ResizeObserver(measureVideoHost).observe(ui.videoHost);

/* ---------------- 自绘标题栏 ---------------- */

const ICON_MAXIMIZE =
  '<svg viewBox="0 0 12 12" aria-hidden="true">' +
  '<rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" />' +
  '</svg>';
const ICON_RESTORE =
  '<svg viewBox="0 0 12 12" aria-hidden="true">' +
  '<rect x="2.5" y="4.5" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.2" />' +
  '<path d="M4.5 4.5V2.5h5v5h-2" fill="none" stroke="currentColor" stroke-width="1.2" />' +
  '</svg>';

ui.btnMinimize.addEventListener('click', () => api.minimizeWindow());
ui.btnMaximize.addEventListener('click', () => api.toggleMaximizeWindow());
ui.btnClose.addEventListener('click', () => api.closeWindow());
api.onMaximized((maximized) => {
  ui.btnMaximize.innerHTML = maximized ? ICON_RESTORE : ICON_MAXIMIZE;
  ui.btnMaximize.title = maximized ? '还原' : '最大化';
  measureVideoHost();
});

/* ---------------- 可编辑标题 ---------------- */

ui.roomTitle.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    ui.roomTitle.blur();
  }
});
ui.roomTitle.addEventListener('blur', () => {
  if ((ui.roomTitle.textContent || '').trim() === '') {
    // contenteditable 里删空后可能留一个 <br>，清掉才能显示占位文案
    ui.roomTitle.innerHTML = '';
  }
});

/* ---------------- 音量滑杆 ---------------- */

function bindVolume(input, label) {
  const update = () => {
    label.textContent = input.value + '%';
  };
  input.addEventListener('input', update);
  update();
}

bindVolume(ui.micVolume, ui.micValue);
bindVolume(ui.speakerVolume, ui.speakerValue);

/* ---------------- 页签（先只切选中态） ---------------- */

for (const tab of document.querySelectorAll('.tabs .tab')) {
  tab.addEventListener('click', () => {
    for (const sibling of tab.parentElement.children) {
      sibling.classList.toggle('active', sibling === tab);
    }
  });
}

/* ---------------- 直播按钮 ---------------- */

let live = false;
ui.btnLive.addEventListener('click', () => {
  // 直播会话（CreateSession / Start）还没接：先只切按钮状态
  live = !live;
  ui.btnLive.classList.toggle('live', live);
  ui.btnLiveText.textContent = live ? '结束直播' : '开始直播';
  logLine(live ? '开始直播（占位，会话命令还没接）' : '结束直播（占位）');
});

/* ---------------- 还没接的按钮 ---------------- */

for (const button of [
  ui.btnBack,
  ui.btnAddMaterial,
  ui.btnClearMaterial,
  ui.btnAudioSettings,
  ui.btnNotifications,
  ui.btnSettings,
]) {
  button.addEventListener('click', () => logLine(button.title || '按钮' + ' 还没接'));
}

/* ---------------- 启动 ---------------- */

void api.getInfo().then((info) => {
  ui.version.textContent = info.version + ' test';
});
void api.getStatus().then((current) => {
  setConnected(current.connected, current.message);
});
api.onStatus((current) => {
  setConnected(current.connected, current.message);
});

requestAnimationFrame(() => measureVideoHost());
