#pragma once

#include <cstdint>
#include <functional>
#include <memory>

class MeWindowPrivate;

// 本地窗口（四层窗口模式的第 3 层）：engine 自己建的窗口，认父到消费端主窗口。
// 分层参考 child_window_presenter 的 host + view：
//   * host —— 进程内隐藏窗口，锚住窗口线程的消息循环，也是 view 没认父时的落点
//   * view —— 挂到 Electron 主窗口下的子窗口，由 DOM 量出来的矩形驱动
// 约束：窗口调用都在窗口线程（跑消息循环的那个线程）上执行；别的线程要用
// PostTask() 把任务排过去——跨线程 SetParent / SetWindowPos 是同步调用，
// 窗口线程不泵消息就会把调用方卡住。
class MeWindow {
  std::unique_ptr<MeWindowPrivate> d_ptr;

public:
  MeWindow();
  ~MeWindow();

  MeWindow(const MeWindow&) = delete;
  MeWindow& operator=(const MeWindow&) = delete;

  // 在调用线程（即跑消息循环的线程）上创建隐藏宿主窗口
  bool Create();
  // 线程安全：投递 WM_CLOSE，消息循环收到 WM_QUIT 后退出
  void Close();

  // 认父到消费端主窗口（Electron 的 HWND，允许跨进程）；view 窗口按需创建
  bool Attach(uint64_t parentHwnd, bool show);
  // 本地窗口在父窗口客户区坐标系下的物理像素矩形
  void SetRect(int32_t x, int32_t y, int32_t width, int32_t height);
  // 从父窗口摘下来：隐藏并还给宿主窗口
  void Detach();

  // 线程安全：把任务排到窗口线程上执行
  bool PostTask(std::function<void()> task);

  // 宿主窗口句柄；未创建时为 0
  uint64_t hwnd() const;
  // 本地窗口（view）句柄；未创建时为 0
  uint64_t viewHwnd() const;
};
