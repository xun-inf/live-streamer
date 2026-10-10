import type { Domain } from '../../common/ipcs/domain.js';
import type { Envelope } from '../../common/ipcs/envelope.js';

// 与 C++ IpcHandler 对应：一个 Domain 一个 handler，由 IpcClient 持有。
// 同步校验消息并转交模块；异步处理前复制字段，不在这里等待 GPU/网络操作。
export interface IpcHandler {
  domain(): Domain;
  // 已认领并处理返回 true；不支持的消息类型或字段无效返回 false。
  onIpcMessage(envelope: Envelope): boolean;
}
