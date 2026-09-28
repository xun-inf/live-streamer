#pragma once

#include "ipchandler.h"

// 窗口域（mewindow.fbs）的消息处理器：把 Envelope 里本域的消息翻成 MeWindow 调用。
// 消息是在 IPC 线程上收到的，窗口操作统一由 MeWindow::PostTask() 排到窗口线程执行；
// MeWindow 实例运行时从 meApp 取，不在这里持有。
// 由 InitializeIpcHandlers()（ipchandler.h）统一注册。
class IpcWindowHandler : public IpcHandler {
public:
  IpcWindowHandler() = default;
  IpcWindowHandler(const IpcWindowHandler&) = delete;
  IpcWindowHandler& operator=(const IpcWindowHandler&) = delete;

  // IpcHandler：本域的消息（Envelope::mewindow_type 有值）处理并返回 true，
  // 不是本域的返回 false
  Domain domain() const override;
  bool OnMessage(const Envelope& envelope) override;
};
