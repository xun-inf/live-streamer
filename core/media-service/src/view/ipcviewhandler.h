#pragma once

#include "../ipc/ipchandler.h"

class IpcViewHandler : public IpcHandler {
public:
  IpcViewHandler() = default;
  IpcViewHandler(const IpcViewHandler&) = delete;
  IpcViewHandler& operator=(const IpcViewHandler&) = delete;

  // IpcHandler：本域的消息（Envelope::ntwindow_type 有值）处理并返回 true，
  // 不是本域的返回 false
  Domain domain() const override;
  bool OnIpcMessage(const Envelope& envelope) override;
};