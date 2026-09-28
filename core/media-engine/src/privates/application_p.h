#pragma once

#include <string>
#include <vector>

#include "ipcserver.h"
#include "mewindow.h"
#include "window_router.h"

class MeApplicationPrivate {
public:
  MeApplicationPrivate();
  ~MeApplicationPrivate();

  MeApplicationPrivate(const MeApplicationPrivate&) = delete;
  MeApplicationPrivate& operator=(const MeApplicationPrivate&) = delete;

  bool Initialize(int argc, char** argv);

  // 启动 IPC 服务并阻塞到进程退出
  bool Exec();

private:
  // IPC 线程上收到的消息：解析 FlatBuffer，把窗口操作排到窗口线程
  void OnMessage(std::vector<uint8_t> message);
  // 客户端断开：Electron 是唯一客户端，断开说明它不在了
  void OnClientDisconnected();

  std::string m_pipeName;
  unsigned long m_parentPid = 0;

  IpcServer m_ipcServer;

  MeWindow m_window;
  // 窗口域的消息分发：OnMessage 只做校验，具体消息交给各域的 router
  WindowRouter m_windowRouter{&m_window};
};
