#pragma once

#include "ipchandler.h"

class NativeWindowHandler : public IpcHandler
{
public:
    NativeWindowHandler();
    NativeWindowHandler(const NativeWindowHandler&) = delete;
    NativeWindowHandler& operator=(const NativeWindowHandler&) = delete;

    // IpcHandler：本域的消息（Envelope::native_window_type 有值）处理并返回 true，
    // 不是本域的返回 false
    Domain domain() const override;
    bool onIpcMessage(const Envelope& envelope) override;
};
