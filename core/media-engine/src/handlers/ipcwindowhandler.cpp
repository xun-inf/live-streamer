#include "ipcwindowhandler.h"

#include "application.h"
#include "mewindow.h"
#include "utils/log.h"

namespace {

const char kComponent[] = "window";

}  // namespace

Domain IpcWindowHandler::domain() const {
  return Domain_Mewindow;
}

bool IpcWindowHandler::OnMessage(const Envelope& envelope) {
  MeWindow* window = meApp->window();
  switch (envelope.mewindow_type()) {
    case MewindowPayload_AttachWindow: {
      const auto* body = envelope.mewindow_as_AttachWindow();
      const uint64_t parentHwnd = body->parent_hwnd();
      const bool show = body->show();
      if (!window->PostTask(
              [window, parentHwnd, show] { window->Attach(parentHwnd, show); })) {
        liveutils::LogWarn(kComponent, "PostTask(AttachWindow) failed");
      }
      return true;
    }
    case MewindowPayload_SetWindowRect: {
      const auto* body = envelope.mewindow_as_SetWindowRect();
      const int32_t x = body->x();
      const int32_t y = body->y();
      const int32_t width = body->width();
      const int32_t height = body->height();
      if (!window->PostTask([window, x, y, width, height] {
            window->SetRect(x, y, width, height);
          })) {
        liveutils::LogWarn(kComponent, "PostTask(SetWindowRect) failed");
      }
      return true;
    }
    case MewindowPayload_DetachWindow:
      if (!window->PostTask([window] { window->Detach(); })) {
        liveutils::LogWarn(kComponent, "PostTask(DetachWindow) failed");
      }
      return true;
    default:
      return false;
  }
}
