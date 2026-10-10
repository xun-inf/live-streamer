import * as flatbuffers from 'flatbuffers';

import { Domain } from '../../common/ipcs/domain.js';
import { Envelope } from '../../common/ipcs/envelope.js';
import { PresentVideoFrame } from '../../common/ipcs/present-video-frame.js';
import { ReleaseVideoFrame } from '../../common/ipcs/release-video-frame.js';
import { ReleaseStreamPreview } from '../../common/ipcs/release-stream-preview.js';
import { StreamPreviewPayload } from '../../common/ipcs/stream-preview-payload.js';
import type { IpcClient } from '../mediaservice/IpcClient.js';
import type { IpcHandler } from '../mediaservice/IpcHandler.js';
import type { StreamPreview } from '../mediaservice/streampreview/StreamPreview.js';

export class StreamPreviewHandler implements IpcHandler {
  constructor(private readonly client: IpcClient, private readonly streamPreview: StreamPreview) {}

  domain(): Domain {
    return Domain.StreamPreview;
  }

  releasePreview(id: number): void {
    const builder = new flatbuffers.Builder(64);
    const body = ReleaseStreamPreview.createReleaseStreamPreview(builder, id);
    Envelope.startEnvelope(builder);
    Envelope.addDomain(builder, this.domain());
    Envelope.addStreamPreviewType(builder, StreamPreviewPayload.ReleaseStreamPreview);
    Envelope.addStreamPreview(builder, body);
    builder.finish(Envelope.endEnvelope(builder));
    this.client.send(builder.asUint8Array());
  }

  onIpcMessage(envelope: Envelope): boolean {
    if (envelope.domain() !== this.domain() ||
        envelope.streamPreviewType() !== StreamPreviewPayload.PresentVideoFrame) return false;
    const body = envelope.streamPreview(new PresentVideoFrame()) as PresentVideoFrame | null;
    if (!body) return false;
    const frame = { id: body.id(), token: body.token(), handle: body.handle(), width: body.width(),
      height: body.height(), timestamp: Number(body.timestampUs()) };
    if (!frame.token || !frame.handle || frame.width < 1 || frame.height < 1 ||
        frame.width > 8192 || frame.height > 8192 || !Number.isSafeInteger(frame.timestamp)) return false;

    // StreamPreview 在资源归还时检查连接代次，旧服务的回执不会发给新服务。
    this.streamPreview.presentFrame(frame, () => {
      const builder = new flatbuffers.Builder(128);
      const body = ReleaseVideoFrame.createReleaseVideoFrame(builder, frame.id, frame.token);
      Envelope.startEnvelope(builder);
      Envelope.addDomain(builder, this.domain());
      Envelope.addStreamPreviewType(builder, StreamPreviewPayload.ReleaseVideoFrame);
      Envelope.addStreamPreview(builder, body);
      builder.finish(Envelope.endEnvelope(builder));
      this.client.send(builder.asUint8Array());
    });
    return true;
  }
}
