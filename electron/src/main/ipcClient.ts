// Named Pipe 客户端：收发格式与 core/media-service 的 ipcserver_p.cpp 一致。
// [uint32 小端长度前缀][FlatBuffer 字节]，读写都必须循环到满：
// pipe 的一次 read 只保证返回"一部分"数据，不能假设一次拿到整帧。

import net from 'node:net';

const kLengthPrefixSize = 4;
const kMaxFrameSize = 8 * 1024 * 1024;

export type FrameHandler = (payload: Buffer) => void;
export type CloseHandler = (reason: string) => void;

export class IpcClient {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private frameHandler: FrameHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private closing = false;

  connect(pipeName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = net.connect(pipeName);
      let connected = false;
      this.closing = false;

      socket.on('connect', () => {
        connected = true;
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        resolve();
      });
      socket.on('data', (chunk: Buffer) => this.handleData(chunk));
      socket.on('error', (error: Error) => {
        if (!connected) {
          reject(error);
          return;
        }
        if (!this.closing) {
          this.closeHandler?.('pipe error: ' + error.message);
        }
      });
      socket.on('close', () => {
        this.socket = null;
        if (!connected) {
          reject(new Error('pipe closed before connected'));
          return;
        }
        if (!this.closing) {
          this.closeHandler?.('pipe closed');
        }
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
    return this.socket !== null && !this.socket.destroyed;
  }

  send(payload: Uint8Array): boolean {
    const socket = this.socket;
    if (socket === null || socket.destroyed) {
      return false;
    }
    const header = Buffer.alloc(kLengthPrefixSize);
    header.writeUInt32LE(payload.length, 0);
    socket.write(Buffer.concat([header, Buffer.from(payload)]));
    return true;
  }

  close(): void {
    const socket = this.socket;
    this.closing = true;
    this.socket = null;
    if (socket !== null) {
      socket.destroy();
    }
  }

  private handleData(chunk: Buffer): void {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= kLengthPrefixSize) {
      const size = this.buffer.readUInt32LE(0);
      if (size === 0 || size > kMaxFrameSize) {
        this.closeHandler?.('invalid frame size: ' + size);
        this.close();
        return;
      }
      if (this.buffer.length < kLengthPrefixSize + size) {
        return;
      }
      const payload = this.buffer.subarray(
        kLengthPrefixSize,
        kLengthPrefixSize + size,
      );
      this.buffer = this.buffer.subarray(kLengthPrefixSize + size);
      this.frameHandler?.(Buffer.from(payload));
    }
  }
}
