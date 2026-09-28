#include "mewindow.h"

#include "./privates/mewindow_p.h"

MeWindow::MeWindow() : d_ptr(std::make_unique<MeWindowPrivate>()) {}

MeWindow::~MeWindow() = default;

bool MeWindow::Create() {
  return d_ptr->Create();
}

void MeWindow::Close() {
  d_ptr->Close();
}

bool MeWindow::Attach(uint64_t parentHwnd, bool show) {
  return d_ptr->Attach(parentHwnd, show);
}

void MeWindow::SetRect(int32_t x, int32_t y, int32_t width, int32_t height) {
  d_ptr->SetRect(x, y, width, height);
}

void MeWindow::Detach() {
  d_ptr->Detach();
}

bool MeWindow::PostTask(std::function<void()> task) {
  return d_ptr->PostTask(std::move(task));
}

uint64_t MeWindow::hwnd() const {
  return d_ptr->hwnd();
}

uint64_t MeWindow::viewHwnd() const {
  return d_ptr->viewHwnd();
}
