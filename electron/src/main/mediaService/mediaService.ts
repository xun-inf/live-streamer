// media-service 对接：启动子进程、连接 Named Pipe、发布连接状态。
// 页面重载复用连接；进程或连接丢失后，再次 ensureConnected 可以恢复。
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { IpcClient } from './IpcClient.js';
import type { AppPaths } from '../appPaths.js';
import { logger } from '../logger.js';
import { NativeWindowMgr } from './NativeWindowMgr.js';

export interface AppStatus {
  connected: boolean;
  message: string;
}

const kReadyTimeoutMs = 10000;
const kConnectTimeoutMs = 1000;
const kNaturalExitWaitMs = 1500;
const kExitWaitMs = 3000;
const kMaxReadyLineLength = 1024;

export interface MediaServiceOptions {
  readonly paths: AppPaths;
}

interface ProcessReadiness {
  child: ChildProcess;
  promise: Promise<void>;
  cancel(error: Error): void;
}

async function exitsWithin(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class MediaService {
  private readonly client = new IpcClient();
  readonly nativeWindowMgr = new NativeWindowMgr(this.client);

  private child: ChildProcess | null = null;
  private readiness: ProcessReadiness | null = null;
  private currentStatus: AppStatus = { connected: false, message: '连接中…' };
  private connecting: Promise<boolean> | null = null;
  private stopPromise: Promise<void> | null = null;
  private generation = 0;
  private stopping = false;
  private initialization: MediaServiceOptions | null = null;
  private readonly statusListeners = new Set<(status: AppStatus) => void>();

  constructor() {
    this.client.setCloseHandler((reason) => {
      this.cancelConnection();
      if (!this.stopping) {
        this.setStatus(false, '已断开: ' + reason);
      }
    });
  }

  // 只绑定依赖；子进程仍由 ensureConnected 按需启动。每个实例只能初始化一次。
  initialize(options: MediaServiceOptions): void {
    if (this.initialization !== null) {
      throw new Error('MediaService is already initialized');
    }
    if (this.stopping) {
      throw new Error('MediaService has been stopped');
    }
    this.initialization = { ...options, paths: { ...options.paths } };
  }

  private get options(): MediaServiceOptions {
    if (this.initialization === null) {
      throw new Error('MediaService must be initialized before use');
    }
    return this.initialization;
  }

  get connected(): boolean {
    return !this.stopping && this.processRunning && this.client.connected;
  }

  get status(): AppStatus {
    return { ...this.currentStatus };
  }

  onStatus(handler: (status: AppStatus) => void): () => void {
    this.statusListeners.add(handler);
    return () => { this.statusListeners.delete(handler); };
  }

  ensureConnected(): Promise<boolean> {
    if (this.initialization === null) {
      return Promise.reject(new Error('MediaService must be initialized before use'));
    }
    if (this.stopping) {
      return Promise.resolve(false);
    }
    if (this.connected) {
      return Promise.resolve(true);
    }
    if (this.connecting !== null) {
      return this.connecting;
    }
    const generation = ++this.generation;
    const task = this.connect(generation).finally(() => {
      if (this.connecting === task) {
        this.connecting = null;
      }
    });
    this.connecting = task;
    return task;
  }

  stop(): Promise<void> {
    if (this.stopPromise !== null) {
      return this.stopPromise;
    }
    this.stopping = true;
    this.nativeWindowMgr.stop();
    const child = this.child;
    this.cancelConnection();
    this.stopPromise = child === null ? Promise.resolve() : this.stopProcess(child);
    if (this.initialization !== null) this.setStatus(false, '正在关闭…');
    return this.stopPromise;
  }

  private get processRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  private startProcess(): boolean {
    if (this.stopping) return false;
    if (this.processRunning) return true;
    if (!fs.existsSync(this.options.paths.mediaServiceExe)) {
      logger.error('找不到 media-service: ' + this.options.paths.mediaServiceExe);
      return false;
    }
    let child: ChildProcess;
    try {
      child = spawn(
        this.options.paths.mediaServiceExe,
        ['--pipe-name=' + this.options.paths.pipeName, '--log=' + this.options.paths.mediaServiceLogPath],
        // 保持非 detached，主进程退出时由 libuv 的 Windows Job 回收服务。
        {
          cwd: path.dirname(this.options.paths.mediaServiceExe),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
          detached: false,
        },
      );
    } catch (error) {
      logger.error('media-service 启动失败:', error);
      return false;
    }
    // 启动失败可能只有 error；error / exit 只报告一次，旧进程不影响新连接。
    let reported = false;
    const report = (what: string, code: number | null, signal: string | null): void => {
      if (reported) return;
      reported = true;
      const isCurrent = this.child === child;
      if (isCurrent) {
        this.child = null;
        this.readiness?.cancel(new Error('media-service exited before READY'));
        this.readiness = null;
      }
      const message = 'media-service ' + what + ': code=' + String(code) + ', signal=' + String(signal);
      if (isCurrent && !this.stopping) logger.warning(message);
      else logger.info(message);
      if (isCurrent && !this.stopping) {
        this.cancelConnection();
        this.setStatus(false, 'media-service 已退出: code=' + String(code) +
          ', signal=' + String(signal ?? ''));
      }
    };
    child.on('error', (error) => {
      logger.error('media-service 进程出错:', error);
      report('启动失败', -1, null);
    });
    child.on('exit', (code, signal) => report('退出', code, signal));
    this.child = child;
    this.readiness = this.waitForReady(child);
    logger.info('media-service 已启动: pid=' + String(child.pid) + ', exe=' + this.options.paths.mediaServiceExe);
    return true;
  }

  private waitForReady(child: ChildProcess): ProcessReadiness {
    const stdout = child.stdout;
    let finish: (error?: Error) => void = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let buffer = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onData = (chunk: string): void => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line === 'READY') {
            finish();
            return;
          }
          newline = buffer.indexOf('\n');
        }
        if (buffer.length > kMaxReadyLineLength) finish(new Error('invalid media-service readiness output'));
      };
      const onEnd = (): void => finish(new Error('media-service stdout closed before READY'));
      const onError = (error: Error): void => finish(error);
      const onExit = (): void => finish(new Error('media-service exited before READY'));
      finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stdout?.off('data', onData);
        stdout?.off('end', onEnd);
        stdout?.off('close', onEnd);
        stdout?.off('error', onError);
        child.off('error', onError);
        child.off('exit', onExit);
        // 就绪后继续消费 stdout，避免子进程后续输出堵住缓冲区。
        stdout?.resume();
        if (error) reject(error);
        else {
          logger.debug('media-service ready');
          resolve();
        }
      };
      if (stdout === null) {
        finish(new Error('media-service stdout is unavailable'));
        return;
      }
      timer = setTimeout(() => finish(new Error('等待 media-service 就绪超时')), kReadyTimeoutMs);
      stdout.setEncoding('utf8');
      stdout.on('data', onData);
      stdout.once('end', onEnd);
      stdout.once('close', onEnd);
      stdout.once('error', onError);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    return { child, promise, cancel: (error) => finish(error) };
  }

  private async stopProcess(child: ChildProcess): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      // 启动失败也会触发 close，未必触发 exit。
      child.once('close', () => resolve());
    });
    // 先关管道，让服务自然退出；超时后才强杀。
    if (await exitsWithin(exited, kNaturalExitWaitMs)) return;
    logger.warning('media-service 没自己退，强杀');
    child.kill();
    if (!(await exitsWithin(exited, kExitWaitMs))) {
      logger.error('media-service 强杀后仍没退出');
      child.kill();
    }
  }

  private cancelConnection(): void {
    ++this.generation;
    this.connecting = null;
    this.readiness?.cancel(new Error('media-service connection cancelled'));
    this.client.close();
  }

  private isCurrent(generation: number): boolean {
    return !this.stopping && this.generation === generation && this.processRunning;
  }

  private setStatus(connected: boolean, message: string): void {
    if (connected === this.currentStatus.connected && message === this.currentStatus.message) {
      return;
    }
    this.currentStatus = { connected, message };
    logger.info('status: ' + message);
    this.nativeWindowMgr.connectionChanged(connected);
    for (const handler of this.statusListeners) {
      try {
        handler(this.status);
      } catch (error) {
        logger.error('media-service status listener failed:', error);
      }
    }
  }

  private async connect(generation: number): Promise<boolean> {
    this.setStatus(false, '连接中…');
    if (!this.startProcess()) {
      if (!this.stopping && this.generation === generation) {
        this.setStatus(false, 'media-service 启动失败: ' + this.options.paths.mediaServiceExe);
      }
      return false;
    }

    const readiness = this.readiness;
    let processReady = false;
    try {
      if (readiness === null || readiness.child !== this.child) throw new Error('media-service readiness is unavailable');
      await readiness.promise;
      processReady = true;
      if (!this.isCurrent(generation)) return false;
      await this.client.connect(this.options.paths.pipeName, kConnectTimeoutMs);
      if (!this.isCurrent(generation)) return false;
      if (!this.client.connected) throw new Error('pipe closed during connection');
      this.setStatus(true, '已连接');
      return true;
    } catch (error) {
      if (this.isCurrent(generation)) {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus(false, '连接 media-service 失败: ' + message);
        // 启动未就绪的进程不能继续复用；回收后，下次请求可重新启动。
        if (!processReady && readiness !== null) await this.stopProcess(readiness.child);
      }
      return false;
    }
  }
}

export const mediaService = new MediaService();
