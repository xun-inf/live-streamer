#include "ntwindow.h"
#include "ntwindow_p.h"

NtWindow::NtWindow() : d_ptr(std::make_unique<NtWindowPrivate>()) {}

NtWindow::~NtWindow() = default;

bool NtWindow::Attach(uint64_t parentHwnd, bool show) {
  return d_ptr->Attach(parentHwnd, show);
}

void NtWindow::SetRect(int32_t x, int32_t y, int32_t width, int32_t height) {
  d_ptr->SetRect(x, y, width, height);
}

void NtWindow::Detach() {
  d_ptr->Detach();
}

void NtWindow::Close() {
  d_ptr->Close();
}

uint64_t NtWindow::viewHwnd() const {
  return d_ptr->viewHwnd();
}