#pragma once

#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "handlers/ipchandler.h"
#include "ipcserver.h"
#include "mewindow.h"

class MeApplicationPrivate {
public:
  MeApplicationPrivate();
  ~MeApplicationPrivate();

  MeApplicationPrivate(const MeApplicationPrivate&) = delete;
  MeApplicationPrivate& operator=(const MeApplicationPrivate&) = delete;

  bool Initialize(int argc, char** argv);

  // 启动 IPC 服务并阻塞到进程退出
  bool Exec();

  MeWindow* window();

  // 注册/反注册 IPC 消息处理器（按 Domain 索引）
  bool RegisterIpcHandler(IpcHandler* handler);
  bool UnregisterIpcHandler(Domain domain);

private:
  // IPC 线程上收到的消息：解析 FlatBuffer，按 Domain 交给注册的 handler
  void OnMessage(std::vector<uint8_t> message);
  // 按域查注册表；IPC 线程分发和注册/反注册并发访问，内部加锁
  IpcHandler* FindIpcHandler(Domain domain);
  // 客户端断开：Electron 是唯一客户端，断开说明它不在了
  void OnClientDisconnected();

  std::string m_pipeName;
  unsigned long m_parentPid = 0;

  IpcServer m_ipcServer;

  MeWindow m_window;

  // 业务域 -> handler；handler 的生命周期由注册方持有
  std::mutex m_handlersMutex;
  std::map<Domain, IpcHandler*> m_handlers;
};
