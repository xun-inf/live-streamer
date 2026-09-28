#include "ipchandler.h"

#include "application.h"
#include "ipcwindowhandler.h"

void InitializeIpcHandlers() {
  // 引擎自带的 handler 进程内一份，初始化只跑一次
  static IpcWindowHandler windowHandler;
  meApp->RegisterIpcHandler(&windowHandler);
}
