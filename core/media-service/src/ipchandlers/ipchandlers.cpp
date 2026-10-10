#include "ipchandlers.h"

#include "nativewindowhandler.h"
#include "streampreviewhandler.h"
#include "ipcserver.h"
#include "base/logger.h"

#include <memory>

bool registerIpcHandlers(IpcServer& server)
{
    if (!server.registerHandler(std::make_shared<NativeWindowHandler>()))
    {
        mediaservice::logger().logError("ipc", "failed to register native window IPC handler");
        return false;
    }
    return server.registerHandler(std::make_shared<StreamPreviewHandler>());
}
