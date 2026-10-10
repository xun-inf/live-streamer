// 一个固定 id 的原生窗口控制对象，对应 media-service 的 NativeWindow。
// 命令通过 IPC 单向发送，返回值表示提交成功，不代表原生侧执行结果。

import * as flatbuffers from 'flatbuffers';

import { AttachNativeWindow } from '../../common/ipcs/attach-native-window.js';
import { DetachNativeWindow } from '../../common/ipcs/detach-native-window.js';
import { ReleaseNativeWindow } from '../../common/ipcs/release-native-window.js';
import { Domain } from '../../common/ipcs/domain.js';
import { Envelope } from '../../common/ipcs/envelope.js';
import { SetNativeWindowRect } from '../../common/ipcs/set-native-window-rect.js';
import { NativeWindowPayload } from '../../common/ipcs/native-window-payload.js';
import type { IpcClient } from './IpcClient.js';

type BodyBuilder = (builder: flatbuffers.Builder) => flatbuffers.Offset;

export class NativeWindow {
  constructor(
    private readonly client: IpcClient,
    readonly id: number,
  ) {}

  // parentHandle 是 Electron 主窗口的原生句柄；原生侧按 id 创建并挂接窗口。
  attach(parentHandle: bigint, show: boolean): boolean {
    return this.send(
      NativeWindowPayload.AttachNativeWindow,
      (builder) => AttachNativeWindow.createAttachNativeWindow(builder, parentHandle, show, this.id),
    );
  }

  // 矩形使用父窗口客户区的物理像素；附加窗口首次 attach 后才接受尺寸。
  setRect(x: number, y: number, width: number, height: number): boolean {
    return this.send(
      NativeWindowPayload.SetNativeWindowRect,
      (builder) => SetNativeWindowRect.createSetNativeWindowRect(builder, x, y, width, height, this.id),
    );
  }

  detach(): boolean {
    return this.send(
      NativeWindowPayload.DetachNativeWindow,
      (builder) => DetachNativeWindow.createDetachNativeWindow(builder, this.id),
    );
  }

  private send(type: NativeWindowPayload, build: BodyBuilder): boolean {
    if (!this.client.connected) {
      return false;
    }
    const builder = new flatbuffers.Builder(128);
    const body = build(builder);
    const envelope = Envelope.createEnvelope(
      builder,
      Domain.NativeWindow,
      type,
      body,
    );
    builder.finish(envelope);
    return this.client.send(builder.asUint8Array());
  }

  release(): boolean {
    return this.send(NativeWindowPayload.ReleaseNativeWindow,
      builder => ReleaseNativeWindow.createReleaseNativeWindow(builder, this.id));
  }
}
