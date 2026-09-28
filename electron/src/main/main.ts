// Electron 主进程：入口。拉起 media-engine 子进程 -> 连它的 Named Pipe ->
// 把主窗口 HWND 交给 engine 认父（四层窗口模式的第 3 层：本地窗口挂在主窗口下），
// 页面量出来的矩形（物理像素、父窗口客户区坐标系）驱动子窗口摆位。
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { argValue, resolvePaths } from './appPaths.js';
import { EngineProcess } from './engineProcess.js';
import { WindowBridge } from './windowBridge.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// dist/main -> electron/src
const sourceDir = path.resolve(currentDir, '..', '..', 'src');

// 路径都在 appPaths.ts 里算：以 UI 进程 exe 所在目录为基准（开发期 electron.exe，产物 live-streamer.exe）
const paths = resolvePaths();
// 调试窗口：默认弹一个（--devtools=0 关掉，连 F12 一起关）
const devtoolsEnabled = (() => {
  const value = argValue('devtools').toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
})();

function log(message: string): void {
  const line = new Date().toISOString() + ' [ui] ' + message;
  console.log(line);
  try {
    fs.appendFileSync(paths.uiLogPath, line + '\n');
  } catch {
    // 日志不可写不影响主流程
  }
}

// 页面量出来的画面区域：x/y/width/height 是 CSS px（相对视口），dpr 用来换算物理像素
interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
}

const bridge = new WindowBridge();
const engineProcess = new EngineProcess(log, onEngineExit);

let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;
let rendererAlive = false;
let engineStarted = false;
let viewAttached = false;
let lastRectKey = '';
let status = { connected: false, message: '连接中…' };

// 渲染进程不在（崩了 / 正在重载）时 webContents.send 会抛，必须吞掉
function sendToRenderer(channel: string, ...args: unknown[]): boolean {
  const target = mainWindow;
  if (target === null || target.isDestroyed() || !rendererAlive) {
    return false;
  }
  try {
    target.webContents.send(channel, ...args);
    return true;
  } catch (error) {
    rendererAlive = false;
    log('send to renderer failed: ' + String(error));
    return false;
  }
}

function setStatus(connected: boolean, message: string): void {
  if (message !== status.message || connected !== status.connected) {
    log('status: ' + message);
  }
  status = { connected, message };
  sendToRenderer('app:status', status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// engine 没了：主进程还活着，把状态摆成断开；页面重载时会重新拉起它
function onEngineExit(code: number | null, signal: string | null): void {
  viewAttached = false;
  engineStarted = false;
  bridge.close();
  if (!shuttingDown) {
    setStatus(
      false,
      'media-engine 已退出: code=' + String(code) + ', signal=' + String(signal ?? ''),
    );
  }
}

function onPipeClosed(reason: string): void {
  setStatus(false, '已断开: ' + reason);
}

// media-engine 可能比 Electron 晚一点创建 pipe，这里重试到超时为止
async function connectWithRetry(): Promise<void> {
  const deadline = Date.now() + 10000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      await bridge.connect(paths.pipeName, onPipeClosed);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(200);
    }
  }
  throw new Error('连接 media-engine 失败: ' + lastError);
}

// Electron 主窗口的 HWND：Windows 下 getNativeWindowHandle 给的就是窗口句柄。
// 64 位进程里是 8 字节，退一步按低 32 位读也能用（句柄值实际用不满 64 位）
function windowHandleOf(target: BrowserWindow): bigint {
  const buffer = target.getNativeWindowHandle();
  return buffer.length >= 8
    ? buffer.readBigUInt64LE(0)
    : BigInt(buffer.readUInt32LE(0));
}

// 页面量出来的矩形 -> 本地窗口（物理像素，父窗口客户区坐标系）
function applyWindowRect(rect: ViewRect): void {
  const dpr = rect.dpr > 0 ? rect.dpr : 1;
  const x = Math.round(rect.x * dpr);
  const y = Math.round(rect.y * dpr);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (!bridge.setWindowRect(x, y, width, height)) {
    return;
  }
  const key = x + ',' + y + ',' + width + ',' + height;
  if (key !== lastRectKey) {
    lastRectKey = key;
    log('window rect: ' + key);
  }
}

// 第 3 层：把 engine 自己建的本地窗口认父到本进程的主窗口上
async function attachWindow(): Promise<void> {
  const target = mainWindow;
  if (target === null || target.isDestroyed()) {
    return;
  }
  const hwnd = windowHandleOf(target);
  if (!bridge.attachWindow(hwnd, true)) {
    log('attachWindow 发送失败: pipe 未连接');
    return;
  }
  viewAttached = true;
  log('attachWindow 已发送: main hwnd=0x' + hwnd.toString(16));
  sendToRenderer('video:measure');
}

function createWindow(): void {
  // 打包产物里没有 config/（只有 bin 内容摊在根部），窗口/任务栏图标由 rcedit 写进 live-streamer.exe；
  // 只有开发期显式传 --config-dir= 时才去仓库 config/ 里找 app.ico
  const iconPath = path.join(paths.configDir, 'app.ico');
  const hasIcon = fs.existsSync(iconPath);
  if (!hasIcon && argValue('config-dir') !== '') {
    log('窗口图标不存在: ' + iconPath);
  }
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 672,
    minWidth: 1020,
    minHeight: 600,
    frame: false,
    show: false,
    title: 'BIGO LIVE Streamer',
    backgroundColor: '#0f141a',
    icon: hasIcon ? iconPath : undefined,
    webPreferences: {
      preload: path.join(sourceDir, 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('close', (event) => {
    if (shuttingDown) {
      return;
    }
    event.preventDefault();
    void shutdown();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererAlive = false;
  });
  // 窗口一动就得重新量：本地窗口是父窗口客户区的内容，父窗口动它必须跟着动
  const requestMeasure = (): void => {
    sendToRenderer('video:measure');
  };
  mainWindow.on('resize', requestMeasure);
  mainWindow.on('move', requestMeasure);
  mainWindow.on('show', requestMeasure);
  mainWindow.on('restore', requestMeasure);
  mainWindow.on('minimize', requestMeasure);
  mainWindow.on('maximize', requestMeasure);
  mainWindow.on('unmaximize', requestMeasure);
  mainWindow.on('enter-full-screen', requestMeasure);
  mainWindow.on('leave-full-screen', requestMeasure);
  // 最大化状态回灌给页面，切标题栏那个按钮的图标
  mainWindow.on('maximize', () => sendToRenderer('window:maximized', true));
  mainWindow.on('unmaximize', () => sendToRenderer('window:maximized', false));
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererAlive = false;
    log('renderer gone: ' + details.reason);
  });
  // 页面里的 console 只有 DevTools 看得到，顺手转进 ui 日志一份，排问题方便
  mainWindow.webContents.on('console-message', (...args: unknown[]) => {
    const event = args[0] as {
      level?: number | string;
      message?: string;
      lineNumber?: number;
      sourceId?: string;
    };
    const message =
      typeof event.message === 'string'
        ? event.message
        : typeof args[1] === 'string'
          ? (args[1] as string)
          : '';
    if (message !== '') {
      log('renderer: ' + message);
    }
  });
  mainWindow.webContents.on('did-finish-load', () => {
    rendererAlive = true;
    void onRendererReady();
  });
  // F12 / Ctrl+Shift+I 随时开关调试窗口
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }
    const isF12 = input.key === 'F12';
    const isInspect =
      (input.control || input.meta) &&
      input.shift &&
      input.key.toLowerCase() === 'i';
    if ((isF12 || isInspect) && mainWindow !== null) {
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });
  void mainWindow.loadFile(path.join(sourceDir, 'renderer', 'index.html'));
  if (devtoolsEnabled) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// engine 必须等窗口 did-finish-load 之后再拉起来（先拉 engine 再建窗口会让退出偶发卡住）
async function onRendererReady(): Promise<void> {
  if (!engineStarted) {
    engineStarted = true;
    if (
      !engineProcess.start({
        exePath: paths.engineExe,
        workingDir: path.dirname(paths.engineExe),
        pipeName: paths.pipeName,
        logPath: paths.engineLogPath,
        parentPid: process.pid,
      })
    ) {
      setStatus(false, 'media-engine 启动失败: ' + paths.engineExe);
      return;
    }
    try {
      await connectWithRetry();
    } catch (error) {
      setStatus(false, error instanceof Error ? error.message : String(error));
      return;
    }
    setStatus(true, '已连接');
    await attachWindow();
    return;
  }
  // 页面重载：pipe 还在主进程里，重新认父 + 让页面重新量一次矩形
  if (bridge.connected) {
    await attachWindow();
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log('window closing');
  // pipe 断了 engine 就没事可做了（它自己也会跟着收），这里再把进程收干净
  bridge.close();
  await engineProcess.stop();
  app.quit();
}

function registerHandlers(): void {
  ipcMain.handle('app:getStatus', () => status);
  ipcMain.handle('app:getInfo', () => ({ version: app.getVersion() }));
  ipcMain.on('video:rect', (_event, rect: unknown) => {
    if (typeof rect !== 'object' || rect === null) {
      return;
    }
    const value = rect as Partial<ViewRect>;
    if (
      typeof value.x !== 'number' ||
      typeof value.y !== 'number' ||
      typeof value.width !== 'number' ||
      typeof value.height !== 'number'
    ) {
      log('忽略非法画面矩形: ' + JSON.stringify(rect));
      return;
    }
    applyWindowRect({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      dpr: typeof value.dpr === 'number' ? value.dpr : 1,
    });
  });
  ipcMain.handle('video:attach', async () => {
    await attachWindow();
    return viewAttached;
  });
  ipcMain.handle('video:detach', () => {
    const sent = bridge.detachWindow();
    viewAttached = false;
    log('view detached: ' + String(sent));
    return sent;
  });
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.on('window:toggleMaximize', () => {
    const target = mainWindow;
    if (target === null || target.isDestroyed()) {
      return;
    }
    if (target.isMaximized()) {
      target.unmaximize();
    } else {
      target.maximize();
    }
  });
  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(paths.uiLogPath), { recursive: true });
  log(
    'starting, pid=' +
      process.pid +
      ', appDir=' +
      paths.appDir +
      ', pipe=' +
      paths.pipeName +
      ', engine=' +
      paths.engineExe +
      ', devtools=' +
      String(devtoolsEnabled),
  );
  registerHandlers();
  // engine 的启动放在窗口 did-finish-load 之后，见 onRendererReady
  createWindow();
}

app.on('before-quit', () => {
  shuttingDown = true;
  // 正常路径 shutdown() 已经收过 engine 了，这里兜底被别处直接 quit 的情况
  if (engineProcess.running) {
    void engineProcess.stop();
  }
});
app.on('window-all-closed', () => {
  app.quit();
});
app.whenReady().then(main);
