#include "ipcviewhandler.h"

#include "application.h"
#include "ntwindow.h"
#include "utils/log.h"

#include <string>

namespace {

const char kComponent[] = "window";

}  // namespace

Domain IpcViewHandler::domain() const {
  return Domain_Ntwindow;
}

// 消息是在 IPC 线程上收到的：窗口操作统一由 msApp->windowMgr()->PostTask(...)
// 排到 UI 线程执行，任务里才碰 NtWindow。协议里的 id：0 = 主窗口，其余按 id 找/建
bool IpcViewHandler::OnIpcMessage(const Envelope& envelope) {
  switch (envelope.ntwindow_type()) {
    case NtwindowPayload_AttachWindow: {
      const auto* body = envelope.ntwindow_as_AttachWindow();
      const NtWindowId id = body->id();
      const uint64_t parentHwnd = body->parent_hwnd();
      const bool show = body->show();
      // Create 会动窗口表，和 PostTask(id) 的查表都放 UI 线程上做，避免跨线程打架
      if (!msApp->windowMgr()->PostTask([id, parentHwnd, show] {
            NtWindow* window = msApp->windowMgr()->Create(id);
            if (window != nullptr && window->Attach(parentHwnd, show)) {
              liveutils::LogInfo(kComponent,
                                 "window " + std::to_string(id) + " attached");
            }
          })) {
        liveutils::LogWarn(kComponent, "PostTask(AttachWindow) failed");
      }
      return true;
    }
    case NtwindowPayload_SetWindowRect: {
      const auto* body = envelope.ntwindow_as_SetWindowRect();
      const NtWindowId id = body->id();
      const int32_t x = body->x();
      const int32_t y = body->y();
      const int32_t width = body->width();
      const int32_t height = body->height();
      if (!msApp->windowMgr()->PostTask(
              id, [x, y, width, height](NtWindow* window) {
                window->SetRect(x, y, width, height);
              })) {
        liveutils::LogWarn(kComponent, "PostTask(SetWindowRect) failed");
      }
      return true;
    }
    case NtwindowPayload_DetachWindow: {
      const NtWindowId id = envelope.ntwindow_as_DetachWindow()->id();
      if (!msApp->windowMgr()->PostTask(id, [](NtWindow* window) {
            window->Detach();
          })) {
        liveutils::LogWarn(kComponent, "PostTask(DetachWindow) failed");
      }
      return true;
    }
    default:
      return false;
  }
}