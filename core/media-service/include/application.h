#pragma once

#include <memory>

#include "config.h"
#include "ipcserver.h"
#include "ntwindowmgr.h"

class MsApplicationPrivate;

class MsApplication {
  std::unique_ptr<MsApplicationPrivate> d_ptr;

  static MsApplication* s_instance;

public:
  MsApplication(int argc, char** argv);
  ~MsApplication();

  MsApplication(const MsApplication&) = delete;
  MsApplication& operator=(const MsApplication&) = delete;

  static MsApplication* instance() {
    return MsApplication::s_instance;
  }

  MsConfig* config() {
    return &m_config;
  }

  IpcServer* ipcServer() {
    return &m_ipcServer;
  }

  NtWindowMgr* windowMgr() {
    return &m_windowMgr;
  }

  bool Initialize();

  bool Exec();

private:
  MsConfig m_config;

  IpcServer m_ipcServer;

  NtWindowMgr m_windowMgr;
};

#define msApp MsApplication::instance()