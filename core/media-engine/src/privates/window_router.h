#pragma once

#include "main_generated.h"

class MeWindow;

// 窗口域（mewindow.fbs）的消息分发：把 Envelope 里本域的消息翻成 MeWindow 调用。
// 消息是在 IPC 线程上收到的，窗口操作统一由 MeWindow::PostTask() 排到窗口线程执行。
// 以后加域（session 等）就是再加一个 router，MeApplicationPrivate::OnMessage 不用改。
class WindowRouter {
public:
  explicit WindowRouter(MeWindow* window);
  WindowRouter(const WindowRouter&) = delete;
  WindowRouter& operator=(const WindowRouter&) = delete;

  // 是自己域的消息（Envelope::mewindow_type 有值）就处理并返回 true，
  // 不是就返回 false
  bool Handle(const Envelope& envelope);

private:
  MeWindow* m_window = nullptr;
};
