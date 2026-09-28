#pragma once

#include "main_generated.h"

// IPC 消息处理器：一个业务域（Domain）对应一个 handler。
// 注册到 MeApplication 后，该域的消息会转给 OnMessage。
//
// 线程约束：OnMessage 在 IPC 线程上被调用，只做校验和转发（比如排到窗口线程），
// 不要阻塞，也不要直接操作窗口。
// 生命周期：注册的 handler 由注册方持有，反注册之后再销毁。
class IpcHandler {
public:
  virtual ~IpcHandler() = default;

  // 本 handler 负责的业务域；Domain_None 保留，不能注册
  virtual Domain domain() const = 0;

  // 收到本域的消息：认领并处理返回 true，不认返回 false
  virtual bool OnMessage(const Envelope& envelope) = 0;
};

// 注册引擎自带的域处理器（窗口域等）到当前 app 上。
// MeApplication 初始化时调用一次；以后加内置域就在 ipchandler.cpp 里加一行
void InitializeIpcHandlers();
