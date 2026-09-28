// 路径与进程参数：Electron 主进程是入口（engine 是它拉起的子进程），
// 命令行参数一律优先，开发和测试脚本靠它覆盖。

import path from 'node:path';

export interface AppPaths {
  // 产物目录：以 UI 进程 exe 所在目录为基准（开发期 electron.exe，产物 live-streamer.exe）
  appDir: string;
  // 配置目录（图标 / bin 资源）：打包时与 exe 同级（scripts/build.py 铺 config/），
  // 开发期用 --config-dir= 指回仓库
  configDir: string;
  uiLogPath: string;
  engineLogPath: string;
  engineExe: string;
  pipeName: string;
}

export function argValue(
  name: string,
  argv: readonly string[] = process.argv,
): string {
  const prefix = '--' + name + '=';
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return '';
}

export function resolvePaths(): AppPaths {
  const appDir = path.dirname(process.execPath);
  const uiLogPath = argValue('log') || path.join(appDir, 'logs', 'ui.log');
  return {
    appDir,
    configDir: argValue('config-dir') || path.join(appDir, 'config'),
    uiLogPath,
    engineLogPath:
      argValue('engine-log') ||
      path.join(path.dirname(uiLogPath), 'media-engine.log'),
    engineExe: argValue('engine') || path.join(appDir, 'media-engine.exe'),
    // Phase 1 不引入随机 token，多实例留到后面
    pipeName:
      argValue('pipe-name') ||
      '\\\\.\\pipe\\live-streamer-' + String(process.pid),
  };
}
