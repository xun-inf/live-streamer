// 本地窗口（第 3 层）的控制面：把主进程的动作编码成 FlatBuffer 发给 engine。
// 消息都是单向的（认父 / 矩形 / 摘除），没有请求-响应配对。

import * as flatbuffers from 'flatbuffers';

import { AttachWindow } from '../common/attach-window.js';
import { DetachWindow } from '../common/detach-window.js';
import { Domain } from '../common/domain.js';
import { Envelope } from '../common/envelope.js';
import { NtwindowPayload } from '../common/ntwindow-payload.js';
import { SetWindowRect } from '../common/set-window-rect.js';
import { IpcClient } from './ipcClient.js';

type BodyBuilder = (builder: flatbuffers.Builder) => flatbuffers.Offset;

export class WindowBridge {
  private client = new IpcClient();

  connect(pipeName: string, onDisconnect: (reason: string) => void): Promise<void> {
    this.client.setCloseHandler(onDisconnect);
    return this.client.connect(pipeName);
  }

  close(): void {
    this.client.close();
  }

  get connected(): boolean {
    return this.client.connected;
  }

  // parentHwnd 是 Electron 主窗口的 HWND；engine 认父后按最近的矩形摆位。
  // id 是 engine 侧的窗口 id：0 = 主窗口，其余按 id 建/找附加窗口
  attachWindow(id: number, parentHwnd: bigint, show: boolean): boolean {
    return this.send(
      NtwindowPayload.AttachWindow,
      (builder) => AttachWindow.createAttachWindow(builder, parentHwnd, show, id),
    );
  }

  // 矩形是父窗口客户区坐标系下的物理像素（页面量出来的 CSS px 乘 dpr 再取整）
  setWindowRect(id: number, x: number, y: number, width: number, height: number): boolean {
    return this.send(
      NtwindowPayload.SetWindowRect,
      (builder) => SetWindowRect.createSetWindowRect(builder, x, y, width, height, id),
    );
  }

  detachWindow(id: number): boolean {
    return this.send(
      NtwindowPayload.DetachWindow,
      (builder) => DetachWindow.createDetachWindow(builder, id),
    );
  }

  // 所有消息都走窗口域（Domain.Ntwindow）；以后有别的业务再加自己的 send 包装
  private send(type: NtwindowPayload, build: BodyBuilder): boolean {
    if (!this.client.connected) {
      return false;
    }
    const builder = new flatbuffers.Builder(128);
    const body = build(builder);
    const envelope = Envelope.createEnvelope(
      builder,
      Domain.Ntwindow,
      type,
      body,
    );
    builder.finish(envelope);
    return this.client.send(builder.asUint8Array());
  }
}
