#pragma once

#include <windows.h>

#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>

class MeWindowPrivate {
public:
  MeWindowPrivate() = default;
  ~MeWindowPrivate();

  MeWindowPrivate(const MeWindowPrivate&) = delete;
  MeWindowPrivate& operator=(const MeWindowPrivate&) = delete;

  bool Create();
  void Close();

  bool Attach(uint64_t parentHwnd, bool show);
  void SetRect(int32_t x, int32_t y, int32_t width, int32_t height);
  void Detach();

  bool PostTask(std::function<void()> task);

  uint64_t hwnd() const;
  uint64_t viewHwnd() const;

  // 窗口线程上执行队列里的任务（窗口过程收到 kMsgRunTask 时调用）
  void RunTasks();

private:
  bool EnsureViewWindow();
  void ApplyRect();
  void Destroy();

  HWND m_hwnd = nullptr;      // host：隐藏的宿主窗口，挂消息队列
  HWND m_viewHwnd = nullptr;  // view：认父到 Electron 主窗口的本地窗口
  int32_t m_rectX = 0;
  int32_t m_rectY = 0;
  int32_t m_rectWidth = 0;
  int32_t m_rectHeight = 0;
  bool m_attached = false;
  std::mutex m_taskMutex;
  std::deque<std::function<void()>> m_tasks;
};
