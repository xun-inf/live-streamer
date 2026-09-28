#include "application.h"

#include "privates/application_p.h"

MeApplication* MeApplication::s_instance = nullptr;

MeApplication::MeApplication(int argc, char** argv)
    : d_ptr(std::make_unique<MeApplicationPrivate>()) {
  MeApplication::s_instance = this;

  d_ptr->Initialize(argc, argv);
}

MeApplication::~MeApplication() {
  if (s_instance == this) {
    s_instance = nullptr;
  }
}

bool MeApplication::Exec() {
  return d_ptr->Exec();
}

MeWindow* MeApplication::window() {
  return d_ptr->window();
}

bool MeApplication::RegisterIpcHandler(IpcHandler* handler) {
  return d_ptr->RegisterIpcHandler(handler);
}

bool MeApplication::UnregisterIpcHandler(Domain domain) {
  return d_ptr->UnregisterIpcHandler(domain);
}
