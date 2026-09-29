#pragma once

#include <cstdint>
#include <memory>

class NtWindowPrivate;

// 本地窗口（四层窗口模式的第 3 层）：engine 自己建的 overlay，盖在消费端主窗口上。
// 窗口是 WS_POPUP 弹窗、owner 指向 Electron 主窗口，不是 WS_CHILD 子窗口：
// Chromium 走 DirectComposition 渲染时子窗口压不上去，弹窗可以；owner 关系保证它
// 一直浮在主窗口上方、随主窗口最小化一起隐藏。host 窗口（退出信号 + 任务泵）由
// NtWindowMgr 统一建一份，本类不管。
// 约束：窗口调用都在窗口线程（跑消息循环的那个线程）上执行；别的线程要用
// NtWindowMgr::PostTask() 把任务排过去——跨线程 SetWindowPos 是同步调用，
// 窗口线程不泵消息就会把调用方卡住。
class NtWindow {
  std::unique_ptr<NtWindowPrivate> d_ptr;

public:
  NtWindow();
  ~NtWindow();

  NtWindow(const NtWindow&) = delete;
  NtWindow& operator=(const NtWindow&) = delete;

  // 认父到消费端主窗口（Electron 的 HWND，允许跨进程）：窗口按需创建/换 owner
  bool Attach(uint64_t parentHwnd, bool show);
  // 本地窗口在父窗口客户区坐标系下的物理像素矩形
  void SetRect(int32_t x, int32_t y, int32_t width, int32_t height);
  // 从父窗口上摘下来：隐藏（窗口留着，可以重新 Attach）
  void Detach();
  // 关掉 view 窗口（对象保留，可以重新 Attach）；没建过则什么也不做
  void Close();

  // 本地窗口（view）句柄；未创建时为 0
  uint64_t viewHwnd() const;
};