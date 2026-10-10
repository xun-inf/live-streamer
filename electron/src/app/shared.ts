// 每个 renderer 获取同一个主进程管理器的 remote 代理，不创建本地管理器或业务转发对象。
const remote = window.require('@electron/remote');
import type { NativeWindowMgrApi } from './types';

export const nativeWindowMgr = remote.getGlobal('nativeWindowMgr') as NativeWindowMgrApi;
