#pragma once

#include <windows.h>

#include <cstdint>

class NtWindowPrivate {
public:
  NtWindowPrivate() = default;
  ~NtWindowPrivate();

  NtWindowPrivate(const NtWindowPrivate&) = delete;
  NtWindowPrivate& operator=(const NtWindowPrivate&) = delete;

  bool Attach(uint64_t parentHwnd, bool show);
  void SetRect(int32_t x, int32_t y, int32_t width, int32_t height);
  void Detach();
  void Close();

  uint64_t viewHwnd() const;

private:
  bool EnsureViewWindow();
  void ApplyRect();
  void DestroyView();

  HWND m_parentHwnd = nullptr;  // 当前 owner：Electron 主窗口，overlay 的定位基准
  HWND m_viewHwnd = nullptr;    // view：浮在主窗口上面的 overlay 弹窗
  int32_t m_rectX = 0;
  int32_t m_rectY = 0;
  int32_t m_rectWidth = 0;
  int32_t m_rectHeight = 0;
  bool m_attached = false;
};