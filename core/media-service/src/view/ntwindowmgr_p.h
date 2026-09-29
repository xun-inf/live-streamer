#pragma once

#include <windows.h>

#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>

#include "ntwindowmgr.h"

class NtWindow;

// NtWindowMgr 的实现，集中三件事：
//   * 共享 host 窗口：既是 UI 线程任务的唤醒目标（kMsgRunTask），也是退出信号
//     （WM_CLOSE -> WM_DESTROY -> WM_QUIT）的载体；view 是 owner 挂在 Electron
//     主窗口上的 overlay 弹窗，不用它做落点
//   * 主窗口 + 按 id 的附加窗口，每个 NtWindow 只管自己的 view 弹窗
//   * UI 线程任务队列：任意线程 PostTask 进来，host 窗口过程收到唤醒消息后按序跑
class NtWindowMgrPrivate {
public:
  NtWindowMgrPrivate();
  ~NtWindowMgrPrivate();

  NtWindowMgrPrivate(const NtWindowMgrPrivate&) = delete;
  NtWindowMgrPrivate& operator=(const NtWindowMgrPrivate&) = delete;

  bool Initialize();
  void Stop();

  uint64_t hostHwnd() const;

  NtWindow* mainWindow();

  NtWindow* Create(NtWindowId id);
  NtWindow* window(NtWindowId id);

  void Close(NtWindowId id);
  void CloseAll();

  bool PostTask(std::function<void()> task);
  bool PostTask(NtWindowId id, std::function<void(NtWindow*)> task);

  // host 窗口过程收到 kMsgRunTask 时调用；正常不直接调
  void RunTasks();

private:
  bool CreateHostWindow();
  void DestroyHostWindow();

  HWND m_hostHwnd = nullptr;
  std::unique_ptr<NtWindow> m_mainWindow;
  std::map<NtWindowId, std::unique_ptr<NtWindow>> m_windows;

  // UI 线程任务队列：别的线程把任务排到这里，host 窗口过程负责跑
  std::mutex m_taskMutex;
  std::deque<std::function<void()>> m_tasks;
  bool m_tasksStopped = false;
};