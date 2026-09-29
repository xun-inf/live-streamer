#pragma once

#include <cstdint>
#include <functional>
#include <memory>

class NtWindow;
class NtWindowMgrPrivate;

// 窗口 id：查询/派发统一用它；kMainWindowId 固定指主窗口
using NtWindowId = std::uint32_t;

// 主窗口的固定 id：window()/Create()/Close()/PostTask() 传它就直接落到主窗口，
// 方便上层不用区分
constexpr NtWindowId kMainWindowId = 0;

// 本地窗口管理器：一份共享 host 窗口 + 主窗口 + 若干按 id 的附加窗口。
//   * host 窗口只建一份：既是 UI 线程任务队列的唤醒目标，也是退出信号
//     （WM_CLOSE -> WM_QUIT）的载体
//   * 每个 NtWindow 的 view 是 owner 挂到 Electron 主窗口上的 overlay 弹窗
//     （不是 WS_CHILD 子窗口，否则压不过 Chromium 的合成层）
//   * 主窗口 Initialize() 时备好对象，进程生命周期内一直存在；
//   * 附加窗口在 Create(id) 时按需建立，一个 id 一个窗口
// 线程模型：Initialize/Stop/CloseAll 在窗口线程（跑消息循环的线程）上调用；
// hostHwnd()/mainWindow()/window() 只读，跨线程读是安全的；
// 其他线程要操作窗口，用 PostTask() 排到 UI 线程执行。
class NtWindowMgr {
  std::unique_ptr<NtWindowMgrPrivate> d_ptr;

public:
  NtWindowMgr();
  ~NtWindowMgr();

  NtWindowMgr(const NtWindowMgr&) = delete;
  NtWindowMgr& operator=(const NtWindowMgr&) = delete;

  // 窗口线程：建共享 host 窗口（幂等）；失败返回 false
  bool Initialize();
  // 窗口线程：停掉任务队列并丢掉没跑的任务；可重复调
  void Stop();

  // 共享 host 窗口句柄；Initialize() 后有效，未创建时为 0
  uint64_t hostHwnd() const;

  // 主窗口；Initialize() 后就存在，进程生命周期内不变
  NtWindow* mainWindow();

  // 创建 id 的附加窗口对象（幂等，view 在 Attach 时按需建）。
  // kMainWindowId 直接返回主窗口；管理器还没 Initialize 时返回 nullptr
  NtWindow* Create(NtWindowId id);
  // 取 id 的窗口：kMainWindowId 返回主窗口，其余没建过返回 nullptr
  NtWindow* window(NtWindowId id);

  // 线程安全：关掉 id 的 view（对象保留，可以重新 Attach）；没建过则什么也不做
  void Close(NtWindowId id);
  // 线程安全：停任务队列，关掉所有 view，最后让 host 收 WM_CLOSE（进程退出）
  void CloseAll();

  // 任意线程：把任务排到 UI 线程执行
  bool PostTask(std::function<void()> task);
  // 按窗口 id 派发的任务：入队只带 id，轮到执行时窗口还在就执行，不在就跳过
  bool PostTask(NtWindowId id, std::function<void(NtWindow*)> task);
};