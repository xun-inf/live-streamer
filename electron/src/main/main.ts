// Electron 主进程：连接 media-engine 的 Named Pipe，把命令与事件在 Renderer 之间转发。
// 共享纹理的 NT 句柄只落到本进程（通路 1），渲染进程只收到 mailbox transfer。
// 参数由 bigolive-streamer.exe 下发，自己不去猜路径。
// electron 是 CJS 内置模块，ESM 下没有具名导出：默认导入后再解构
import electron, { type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EngineController,
  type FrameReadyInfo,
  type HelloInfo,
  type TexturePoolInfo,
} from './engineController.js';
import { SharedTextureBridge } from './sharedTextureBridge.js';

const { app, ipcMain } = electron;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// dist/main -> electron/src
const sourceDir = path.resolve(currentDir, '..', '..', 'src');

function argValue(name: string): string {
  const prefix = '--' + name + '=';
  for (const arg of process.argv) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return '';
}

const pipeName = argValue('pipe-name');
const assetsDir = argValue('assets');
const configPath = argValue('config');
const logPath = argValue('log');

function log(message: string): void {
  const line = new Date().toISOString() + ' [ui] ' + message;
  console.log(line);
  if (logPath !== '') {
    try {
      fs.appendFileSync(logPath, line + '\n');
    } catch {
      // 日志不可写不影响主流程
    }
  }
}

interface PoolSummary {
  slots: number;
  width: number;
  height: number;
  pixelFormat: number;
}

const controller = new EngineController();
const bridge = new SharedTextureBridge();

let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;
let rendererAlive = false;
let engineStarted = false;
let helloInfo: HelloInfo | null = null;
let handshakePromise: Promise<HelloInfo> | null = null;
let poolSummary: PoolSummary | null = null;
let status = { connected: false, message: '连接中…' };

// 渲染进程不在（崩了 / 正在重载）时 webContents.send 会抛，必须吞掉：
// 调用方靠返回值决定要不要把槽还回去，否则帧池会被慢慢占死
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
  status = { connected, message };
  log('status: ' + message);
  sendToRenderer('engine:status', status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// media-engine 可能比 Electron 晚一点创建 pipe，这里重试到超时为止
async function connectWithRetry(): Promise<void> {
  const deadline = Date.now() + 10000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      await controller.connect(pipeName);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(200);
    }
  }
  throw new Error('连接 media-engine 失败: ' + lastError);
}

// 还槽：engine 收到 ReleaseSlot 之前不会复写那个槽，漏一个就少一个
function ackSlot(slot: number): void {
  if (!controller.releaseSlot(slot)) {
    log('slot ' + slot + ' 的 ACK 没发出去: pipe 已断开');
  }
}

// 握手只在第一次（或重连后）做；页面重载不需要重新 import 句柄
function handshake(): Promise<HelloInfo> {
  if (helloInfo !== null) {
    return Promise.resolve(helloInfo);
  }
  if (handshakePromise === null) {
    handshakePromise = controller
      .hello(process.pid)
      .then((info) => {
        helloInfo = info;
        log('hello ack: engine=' +
          info.engineVersion +
          ', protocol=' +
          info.protocolVersion +
          ', pid=' +
          info.processId);
        return info;
      })
      .finally(() => {
        handshakePromise = null;
      });
  }
  return handshakePromise;
}

function createWindow(): void {
  const iconPath = assetsDir === '' ? '' : path.join(assetsDir, 'app.ico');
  mainWindow = new electron.BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    title: 'bigolive-streamer',
    backgroundColor: '#12161c',
    icon: iconPath !== '' && fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(sourceDir, 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Phase 2 起开沙箱：preload 只用 contextBridge / ipcRenderer / sharedTexture
      sandbox: true,
    },
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
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererAlive = false;
    log('renderer gone: ' + details.reason);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    rendererAlive = true;
    void onRendererReady();
  });
  void mainWindow.loadFile(path.join(sourceDir, 'renderer', 'index.html'));
}

// engine 必须等窗口 did-finish-load 之后再拉起来：先拉 engine 再建窗口会让退出偶发卡死在
// app.quit()（SANDBOX-GUIDE 5.5 实测 4/15 vs 14/14）
async function onRendererReady(): Promise<void> {
  if (!engineStarted) {
    engineStarted = true;
    if (pipeName === '') {
      setStatus(false, '缺少 --pipe-name 参数');
      return;
    }
    try {
      await connectWithRetry();
    } catch (error) {
      setStatus(false, error instanceof Error ? error.message : String(error));
      return;
    }
    setStatus(true, '已连接: ' + pipeName);
    try {
      await handshake();
    } catch (error) {
      log('hello 失败: ' + String(error));
    }
    return;
  }
  // 页面重载：通路 1 下句柄落在主进程，pid 没变，不需要重新 import，恢复投递即可
  if (poolSummary !== null && sendToRenderer('engine:texturePool', poolSummary)) {
    log('页面重载，恢复共享纹理投递');
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log('window closing, destroy session then quit');
  try {
    await controller.destroySession();
  } catch (error) {
    log('destroySession failed: ' + String(error));
  }
  controller.close();
  app.quit();
}

function registerHandlers(): void {
  ipcMain.handle('engine:getStatus', () => status);
  ipcMain.handle('engine:hello', () => handshake());
  ipcMain.handle('engine:createSession', async () => ({
    sessionId: await controller.createSession(),
  }));
  ipcMain.handle('engine:start', async () => ({
    frameRate: await controller.start(),
  }));
  ipcMain.handle('engine:stop', async () => {
    await controller.stop();
    return true;
  });
  ipcMain.handle('engine:destroySession', async () => {
    await controller.destroySession();
    return true;
  });
  ipcMain.on('engine:slotRelease', (_event, slot: unknown) => {
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) {
      log('忽略非法槽号: ' + String(slot));
      return;
    }
    ackSlot(slot);
  });
}

controller.on('engineEvent', (info) => {
  sendToRenderer('engine:event', info);
});

// 帧池就绪：句柄落到主进程，渲染进程只知道尺寸
controller.on('texturePoolReady', (info: TexturePoolInfo) => {
  const imported = bridge.importPool(info, log);
  poolSummary = {
    slots: info.slots,
    width: info.width,
    height: info.height,
    pixelFormat: info.pixelFormat,
  };
  log('texture pool: ' +
    info.slots +
    ' slots, ' +
    info.width +
    'x' +
    info.height +
    ', pixel_format=' +
    info.pixelFormat +
    ', imported=' +
    String(imported));
  if (!imported) {
    sendToRenderer('engine:textureError', '共享纹理导入失败，页面只能看控制面');
    return;
  }
  sendToRenderer('engine:texturePool', poolSummary);
});

// 每帧只转一次 mailbox；没人收（页面在重载 / 已崩）就把槽还回去
controller.on('frameReady', (frame: FrameReadyInfo) => {
  const transfer = bridge.startTransfer(frame.slot);
  if (transfer === null) {
    ackSlot(frame.slot);
    return;
  }
  if (!sendToRenderer('engine:frame', frame.slot, frame.frameId, frame.timestampUs, transfer)) {
    ackSlot(frame.slot);
  }
});

controller.on('disconnected', (reason) => {
  setStatus(false, '已断开: ' + reason);
});
controller.on('protocolError', (message) => {
  log('protocol error: ' + message);
});

async function main(): Promise<void> {
  log('starting, pid=' +
    process.pid +
    ', pipe=' +
    pipeName +
    ', config=' +
    configPath +
    ', assets=' +
    assetsDir);
  registerHandlers();
  // engine 的启动放在窗口 did-finish-load 之后，见 onRendererReady
  createWindow();
}

app.on('before-quit', () => {
  shuttingDown = true;
  // 退出前把主进程持有的 import 对象还回去（engine 那边由宿主负责收尾）
  bridge.releaseAll(log);
});
app.on('window-all-closed', () => {
  app.quit();
});
app.whenReady().then(main);
