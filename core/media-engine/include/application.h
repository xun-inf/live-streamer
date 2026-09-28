#pragma once

#include <memory>

#include "handlers/ipchandler.h"
#include "mewindow.h"

class MeApplicationPrivate;

class MeApplication {
  std::unique_ptr<MeApplicationPrivate> d_ptr;

public:
  MeApplication(int argc, char** argv);
  ~MeApplication();

  MeApplication(const MeApplication&) = delete;
  MeApplication& operator=(const MeApplication&) = delete;

  static MeApplication* Instance() {
    return MeApplication::s_instance;
  }

  bool Exec();

  MeWindow* window();

  // 注册 IPC 消息处理器：按 handler->domain() 索引，一个域只能注册一个。
  // handler 由调用方持有，反注册之后再销毁
  bool RegisterIpcHandler(IpcHandler* handler);

  // 反注册某域的处理器：返回之前是否有注册
  bool UnregisterIpcHandler(Domain domain);

private:
  static MeApplication* s_instance;
};

#define meApp MeApplication::Instance()