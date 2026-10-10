// media-service IPC 字节流：[uint32 小端长度前缀][FlatBuffer 字节]。
// 每个连接独立持有接收缓冲和发送队列，关闭后不向新连接重放消息。

import net from 'node:net';

const kLengthPrefixSize = 4;
const kMaxFrameSize = 8 * 1024 * 1024;
const kMaxBufferedSendBytes = 16 * 1024 * 1024;
const kConnectTimeoutMs = 1000;

export type FrameHandler = (payload: Buffer) => void;
export type CloseHandler = (reason: string) => void;

interface Connection {
  socket: net.Socket;
  ready: boolean;
  resolveConnect: (() => void) | null;
  rejectConnect: ((error: Error) => void) | null;
  connectTimer: ReturnType<typeof setTimeout> | null;
  buffer: Buffer;
  writeBlocked: boolean;
  sendQueue: (Buffer | undefined)[];
  queueHead: number;
  queuedBytes: number;
}

export class IpcClient {
  private connection: Connection | null = null;
  private frameHandler: FrameHandler | null = null;
  private closeHandler: CloseHandler | null = null;

  connect(pipeName: string, timeoutMs = kConnectTimeoutMs): Promise<void> {
    this.close();
    return new Promise<void>((resolve, reject) => {
      let socket: net.Socket;
      try {
        socket = net.connect({ path: pipeName });
      } catch (error) {
        reject(error);
        return;
      }
      const connection: Connection = {
        socket,
        ready: false,
        resolveConnect: resolve,
        rejectConnect: reject,
        connectTimer: null,
        buffer: Buffer.alloc(0),
        writeBlocked: false,
        sendQueue: [],
        queueHead: 0,
        queuedBytes: 0,
      };
      this.connection = connection;
      connection.connectTimer = setTimeout(() => {
        this.finishConnection(connection, new Error('pipe connection timed out'), true);
      }, timeoutMs);

      socket.once('connect', () => {
        if (this.connection !== connection) return;
        if (connection.connectTimer !== null) {
          clearTimeout(connection.connectTimer);
          connection.connectTimer = null;
        }
        connection.ready = true;
        connection.resolveConnect?.();
        connection.resolveConnect = null;
        connection.rejectConnect = null;
      });
      socket.on('data', (chunk: Buffer) => {
        if (this.connection === connection && connection.ready) {
          this.handleData(connection, chunk);
        }
      });
      socket.on('drain', () => {
        if (this.connection !== connection || !connection.ready) return;
        connection.writeBlocked = false;
        this.flush(connection);
      });
      socket.on('error', (error: Error) => {
        this.finishConnection(connection, new Error('pipe error: ' + error.message), true);
      });
      socket.on('end', () => {
        const reason = connection.buffer.length === 0 ? 'pipe closed' : 'incomplete IPC frame';
        this.finishConnection(connection, new Error(reason), true);
      });
      socket.on('close', () => {
        this.finishConnection(connection, new Error('pipe closed'), true);
      });
    });
  }

  setFrameHandler(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  setCloseHandler(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  get connected(): boolean {
    const connection = this.connection;
    return connection !== null && connection.ready && !connection.socket.destroyed;
  }

  // true 表示当前连接已接受本帧；不表示对端已经收到或执行业务。
  // socket.write(false) 也已接受本帧，仅要求等待 drain 后再继续写。
  send(payload: Uint8Array): boolean {
    const connection = this.connection;
    if (
      connection === null ||
      !connection.ready ||
      connection.socket.destroyed ||
      !connection.socket.writable ||
      payload.length === 0 ||
      payload.length > kMaxFrameSize
    ) {
      return false;
    }
    const frameSize = kLengthPrefixSize + payload.length;
    if (
      connection.queuedBytes + connection.socket.writableLength + frameSize >
      kMaxBufferedSendBytes
    ) {
      return false;
    }
    const frame = Buffer.allocUnsafe(frameSize);
    frame.writeUInt32LE(payload.length, 0);
    frame.set(payload, kLengthPrefixSize);
    connection.sendQueue.push(frame);
    connection.queuedBytes += frameSize;
    return this.flush(connection);
  }

  close(): void {
    const connection = this.connection;
    if (connection !== null) {
      this.finishConnection(connection, new Error('IPC connection cancelled'), false);
    }
  }

  private finishConnection(connection: Connection, error: Error, notify: boolean): void {
    if (this.connection !== connection) return;
    this.connection = null;
    const wasReady = connection.ready;
    if (connection.connectTimer !== null) {
      clearTimeout(connection.connectTimer);
      connection.connectTimer = null;
    }
    connection.ready = false;
    connection.buffer = Buffer.alloc(0);
    connection.sendQueue = [];
    connection.queueHead = 0;
    connection.queuedBytes = 0;
    connection.rejectConnect?.(error);
    connection.resolveConnect = null;
    connection.rejectConnect = null;
    connection.socket.destroy();
    // 先解除连接，再回调；error/end/close 的后续事件不会重复通知。
    if (notify && wasReady) {
      try {
        this.closeHandler?.(error.message);
      } catch (callbackError) {
        console.error('IPC close handler failed:', callbackError);
      }
    }
  }

  private flush(connection: Connection): boolean {
    while (
      this.connection === connection &&
      connection.ready &&
      !connection.writeBlocked &&
      connection.queueHead < connection.sendQueue.length
    ) {
      const frame = connection.sendQueue[connection.queueHead]!;
      connection.sendQueue[connection.queueHead++] = undefined;
      connection.queuedBytes -= frame.length;
      try {
        // 无论返回 true/false 都不能把此帧重新放回队列。
        connection.writeBlocked = !connection.socket.write(frame);
      } catch (error) {
        this.finishConnection(connection, new Error('pipe write failed: ' + String(error)), true);
        return false;
      }
      if (connection.queueHead === connection.sendQueue.length) {
        connection.sendQueue = [];
        connection.queueHead = 0;
      } else if (connection.queueHead >= 1024) {
        connection.sendQueue = connection.sendQueue.slice(connection.queueHead);
        connection.queueHead = 0;
      }
    }
    return this.connection === connection && connection.ready;
  }

  private handleData(connection: Connection, chunk: Buffer): void {
    connection.buffer =
      connection.buffer.length === 0 ? chunk : Buffer.concat([connection.buffer, chunk]);
    while (this.connection === connection && connection.buffer.length >= kLengthPrefixSize) {
      const size = connection.buffer.readUInt32LE(0);
      if (size === 0 || size > kMaxFrameSize) {
        this.finishConnection(connection, new Error('invalid frame size: ' + size), true);
        return;
      }
      if (connection.buffer.length < kLengthPrefixSize + size) return;
      const payload = Buffer.from(
        connection.buffer.subarray(kLengthPrefixSize, kLengthPrefixSize + size),
      );
      connection.buffer = connection.buffer.subarray(kLengthPrefixSize + size);
      try {
        this.frameHandler?.(payload);
      } catch (error) {
        this.finishConnection(connection, new Error('IPC frame handler failed: ' + String(error)), true);
        return;
      }
    }
  }
}
