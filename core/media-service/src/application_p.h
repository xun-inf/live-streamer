#pragma once

#include "config.h"

class MsApplication;

class MsApplicationPrivate {
public:
  explicit MsApplicationPrivate(MsApplication* app);
  ~MsApplicationPrivate();

  MsApplicationPrivate(const MsApplicationPrivate&) = delete;
  MsApplicationPrivate& operator=(const MsApplicationPrivate&) = delete;

  bool Initialize(MsConfig* config);

  // 启动 IPC 服务并阻塞到进程退出
  bool Exec();

private:
  // 客户端断开：Electron 是唯一客户端，断开说明它不在了
  void OnClientDisconnected();

  // 宿主 app：config/ipcServer/windowMgr 都在它身上，这里只借指针
  MsApplication* m_app = nullptr;
  MsConfig* m_config = nullptr;
  unsigned long m_parentPid = 0;
};