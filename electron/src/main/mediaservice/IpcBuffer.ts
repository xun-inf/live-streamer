import { ByteBuffer } from 'flatbuffers';
import { Envelope } from '../../common/ipcs/envelope.js';

// JS FlatBuffers 默认允许越界读取并得到 0；接收端需要显式检查。
// 这里只检查读取范围和 table 布局，具体 union 和业务字段由各 handler 校验。
class IpcBuffer extends ByteBuffer {
  private requireRange(offset: number, length: number): void {
    if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset > this.capacity() - length) {
      throw new Error('Invalid IPC FlatBuffer range');
    }
  }

  override readUint8(offset: number): number {
    this.requireRange(offset, 1);
    return super.readUint8(offset);
  }

  override readUint16(offset: number): number {
    this.requireRange(offset, 2);
    return super.readUint16(offset);
  }

  override readInt32(offset: number): number {
    this.requireRange(offset, 4);
    return super.readInt32(offset);
  }

  override __offset(position: number, field: number): number {
    const vtable = position - this.readInt32(position);
    const length = this.readUint16(vtable);
    const size = this.readUint16(vtable + 2);
    if (length < 4 || length % 2 !== 0 || size < 4) throw new Error('Invalid IPC FlatBuffer table');
    this.requireRange(vtable, length);
    this.requireRange(position, size);
    const offset = field < length ? this.readUint16(vtable + field) : 0;
    if (offset !== 0 && (offset < 4 || offset >= size)) throw new Error('Invalid IPC FlatBuffer field');
    return offset;
  }
}

export function readEnvelope(payload: Buffer): Envelope {
  const buffer = new IpcBuffer(payload);
  const root = buffer.readUint32(0);
  if (root < 4 || root > payload.length - 4) throw new Error('Invalid IPC envelope root');
  return new Envelope().__init(root, buffer);
}
