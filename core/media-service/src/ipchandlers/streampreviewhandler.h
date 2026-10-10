#pragma once

#include "ipchandler.h"

class StreamPreviewHandler : public IpcHandler
{
public:
    Domain domain() const override;
    bool onIpcMessage(const Envelope& envelope) override;
};
