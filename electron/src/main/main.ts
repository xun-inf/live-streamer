// Electron 入口：创建主窗口、连接 media-service，并统一处理应用退出。
import { app, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerHandlers } from './ipcmain/registerHandlers.js';
import { mediaService } from './mediaservice/index.js';
import { argValue, resolvePaths } from './appPaths.js';
import { logger } from './logger.js';
import { initializeRemote } from './remote.js';
import { mainWindow } from './windows/mainWindow.js';
import { windowManager } from './windows/windowManager.js';
import { childWindow } from './windows/childWindow.js';

const paths = resolvePaths();

// 页面使用固定深色主题，原生非客户区也保持深色，避免拖动时露出浅色边框。
nativeTheme.themeSource = 'dark';

logger.initialize(paths.mainLogPath);
initializeRemote();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// preload 保留源码路径；app 使用 Vite 开发地址或 dist/app 构建产物。
const sourceDir = path.resolve(currentDir, '..', '..', 'src');
const devServerUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
const devtoolsValue = argValue('devtools').toLowerCase();
const devtoolsEnabled = !['0', 'false', 'off'].includes(devtoolsValue);

let unregisterHandlers: (() => void) | null = null;
let shuttingDown = false;
let quitAllowed = false;
let shutdownPromise: Promise<void> | null = null;

mediaService.initialize({ paths });

const nativeWindowMgr = mediaService.nativeWindowMgr;

const appBaseUrl = devServerUrl || pathToFileURL(path.resolve(currentDir, '..', 'app') + path.sep).href;
const windowConfig = {
  pageUrls: { Settings: new URL('settings.html', appBaseUrl).href,
    SecondScreen: new URL('secondscreen.html', appBaseUrl).href },
  preload: path.join(sourceDir, 'preload', 'preload.cjs'),
};
Object.assign(globalThis, { nativeWindowMgr: nativeWindowMgr, windowManager, windowConfig });

mainWindow.initialize({
  paths,
  sourceDir,
  pageUrl: new URL('main.html', appBaseUrl).href,
  devtoolsEnabled,
  canClose: () => quitAllowed,
  onClose: () => { void shutdown(); },
});

childWindow.initialize({ pageUrl: windowConfig.pageUrls.Settings, preload: windowConfig.preload });

logger.info('starting, pid=' + process.pid + ', appDir=' + paths.appDir +
  ', pipe=' + paths.pipeName + ', mediaServiceExe=' + paths.mediaServiceExe + ', devtools=' + devtoolsEnabled);

app.on('before-quit', (event) => {
  if (quitAllowed) return;
  event.preventDefault();
  void shutdown();
});
app.on('window-all-closed', () => { void shutdown(); });
app.whenReady().then(() => {
  if (shuttingDown) return;
  unregisterHandlers = registerHandlers(mediaService, windowConfig.pageUrls.SecondScreen);
  mainWindow.create();
  childWindow.create();
}).catch((error: unknown) => {
  logger.error('main start failed:', error);
  void shutdown();
});

function shutdown(): Promise<void> {
  if (shutdownPromise !== null) return shutdownPromise;
  shuttingDown = true;
  logger.info('window closing');
  windowManager.stop();
  mainWindow.stop();
  unregisterHandlers?.();
  unregisterHandlers = null;
  shutdownPromise = mediaService.stop().catch((error: unknown) => {
    logger.error('media-service stop failed:', error);
  }).then(() => {
    quitAllowed = true;
    windowManager.destroy();
    app.quit();
  });
  return shutdownPromise;
}
