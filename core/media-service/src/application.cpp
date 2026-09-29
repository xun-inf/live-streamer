#include "application.h"

#include "application_p.h"
#include "./view/ipcviewhandler.h"

MsApplication* MsApplication::s_instance = nullptr;

MsApplication::MsApplication(int argc, char** argv)
    : d_ptr(std::make_unique<MsApplicationPrivate>(this))
    , m_config(argc, argv) {
  MsApplication::s_instance = this;
}

MsApplication::~MsApplication() {
  if (s_instance == this) {
    s_instance = nullptr;
  }
}

bool MsApplication::Initialize() {
  m_ipcServer.Register(std::make_shared<IpcViewHandler>());

  return d_ptr->Initialize(&m_config);
}

bool MsApplication::Exec() {
  return d_ptr->Exec();
}

