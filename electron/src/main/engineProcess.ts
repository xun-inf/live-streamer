// media-engine 的进程管理：主进程是入口，engine 是它的子进程。
// 正常退出由我们主动收；我们被强杀时靠 engine 自己的 --parent-pid 兜底。

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

// 关掉 pipe 之后等 engine 自己收的宽限时间；超时才强杀
const kNaturalExitWaitMs = 1500;
const kExitWaitMs = 3000;

export interface EngineLaunchOptions {
  exePath: string;
  workingDir: string;
  pipeName: string;
  logPath: string;
  parentPid: number;
}

export type EngineLog = (message: string) => void;
export type EngineExit = (code: number | null, signal: string | null) => void;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class EngineProcess {
  private child: ChildProcess | null = null;
  private stopping = false;

  constructor(
    private readonly onLog: EngineLog,
    private readonly onExit: EngineExit,
  ) {}

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  start(options: EngineLaunchOptions): boolean {
    if (this.running) {
      return true;
    }
    if (!fs.existsSync(options.exePath)) {
      this.onLog('找不到 media-engine: ' + options.exePath);
      return false;
    }
    this.stopping = false;
    const child = spawn(
      options.exePath,
      [
        '--pipe-name=' + options.pipeName,
        '--log=' + options.logPath,
        '--parent-pid=' + String(options.parentPid),
      ],
      { cwd: options.workingDir, windowsHide: true, stdio: 'ignore' },
    );
    // error 和 exit 都可能到（启动失败时只有 error），只认第一次
    let reported = false;
    const report = (
      what: string,
      code: number | null,
      signal: string | null,
    ): void => {
      if (reported) {
        return;
      }
      reported = true;
      if (this.child === child) {
        this.child = null;
      }
      this.onLog(
        'media-engine ' +
          what +
          ': code=' +
          String(code) +
          ', signal=' +
          String(signal),
      );
      // 我们自己收的进程不算异常退出，别再往上报告一次
      if (!this.stopping) {
        this.onExit(code, signal);
      }
    };
    child.on('error', (error) => {
      this.onLog('media-engine 进程出错: ' + String(error));
      report('启动失败', -1, null);
    });
    child.on('exit', (code, signal) => report('退出', code, signal));
    this.child = child;
    this.onLog(
      'media-engine 已启动: pid=' + String(child.pid) + ', exe=' + options.exePath,
    );
    return true;
  }

  // 收进程：调用方先关 pipe（engine 那边没事可做了，它会自己退），这里负责把进程收干净
  async stop(): Promise<void> {
    const child = this.child;
    if (child === null) {
      return;
    }
    this.stopping = true;
    this.child = null;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });
    // 管道断开后 engine 会自己收（见媒体引擎的 OnClientDisconnected），先给它一点时间
    const natural = await Promise.race([
      exited.then(() => true),
      delay(kNaturalExitWaitMs).then(() => false),
    ]);
    if (natural) {
      return;
    }
    this.onLog('media-engine 没自己退，强杀');
    child.kill();
    const timedOut = await Promise.race([
      exited.then(() => false),
      delay(kExitWaitMs).then(() => true),
    ]);
    if (timedOut) {
      this.onLog('media-engine 强杀后仍没退出');
      child.kill();
    }
  }
}
