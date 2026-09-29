#pragma once

#include "main_generated.h"

// IPC 消息处理器：一个业务域（Domain）对应一个 handler。
// 注册到 IpcServer 后，该域的消息会转给 OnIpcMessage。
//
// 线程约束：OnIpcMessage 在 IPC 线程上被调用，只做校验和转发（比如用
// msApp->windowMgr()->PostTask() 排到 UI 线程），不要阻塞，也不要直接操作窗口。
// 生命周期：handler 以 shared_ptr 注册到 IpcServer，反注册之后再销毁。
class IpcHandler {
public:
  virtual ~IpcHandler() = default;

  // 本 handler 负责的业务域；Domain_None 保留，不能注册
  virtual Domain domain() const = 0;

  // 收到本域的消息：认领并处理返回 true，不认返回 false
  virtual bool OnIpcMessage(const Envelope& envelope) = 0;
};