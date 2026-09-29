#include "ntwindowmgr.h"
#include "ntwindowmgr_p.h"

#include <utility>

NtWindowMgr::NtWindowMgr() : d_ptr(std::make_unique<NtWindowMgrPrivate>()) {}

NtWindowMgr::~NtWindowMgr() = default;

bool NtWindowMgr::Initialize() {
  return d_ptr->Initialize();
}

void NtWindowMgr::Stop() {
  d_ptr->Stop();
}

uint64_t NtWindowMgr::hostHwnd() const {
  return d_ptr->hostHwnd();
}

NtWindow* NtWindowMgr::mainWindow() {
  return d_ptr->mainWindow();
}

NtWindow* NtWindowMgr::Create(NtWindowId id) {
  return d_ptr->Create(id);
}

NtWindow* NtWindowMgr::window(NtWindowId id) {
  return d_ptr->window(id);
}

void NtWindowMgr::Close(NtWindowId id) {
  d_ptr->Close(id);
}

void NtWindowMgr::CloseAll() {
  d_ptr->CloseAll();
}

bool NtWindowMgr::PostTask(std::function<void()> task) {
  return d_ptr->PostTask(std::move(task));
}

bool NtWindowMgr::PostTask(NtWindowId id, std::function<void(NtWindow*)> task) {
  return d_ptr->PostTask(id, std::move(task));
}