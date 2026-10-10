import type { IpcClient } from '../mediaservice/IpcClient.js';
import type { StreamPreview } from '../mediaservice/streampreview/StreamPreview.js';
import { StreamPreviewHandler } from './StreamPreviewHandler.js';

// 与 media-service/src/ipchandlers 对应，集中绑定协议 handler 和功能模块。
export function registerHandlers(client: IpcClient, streamPreview: StreamPreview): void {
  if (!client.registerHandler(new StreamPreviewHandler(client, streamPreview))) {
    throw new Error('StreamPreview IPC handler already registered');
  }
}
