#pragma once

#include "ipcs/ipc_protocol.h"

// IPC 消息处理器：一个业务域（Domain）对应一个 handler。
// 注册到 IpcServer 后，该域的消息会转给 onIpcMessage。
//
// 线程约束：onIpcMessage 在 IPC 线程上被调用，只做校验和转发（比如用
// msApp->eventLoop()->postTask() 排到 UI 线程），不要阻塞，也不要直接操作窗口。
// 生命周期：IpcServer 持有注册的 shared_ptr，直到服务器销毁。
// Envelope 及其字段指针只在本次调用期间有效；异步任务必须复制所需字段。
class IpcHandler
{
public:
    virtual ~IpcHandler() = default;

    // 本 handler 负责的业务域；Domain_None 保留，不能注册
    virtual Domain domain() const = 0;

    // 校验本域的 payload 类型、非空消息体及业务字段；认领并处理返回 true。
    virtual bool onIpcMessage(const Envelope& envelope) = 0;
};
