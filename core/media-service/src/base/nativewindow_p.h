#pragma once

#include <windows.h>

#include <cstdint>

class NativeWindowPrivate
{
public:
    NativeWindowPrivate();
    ~NativeWindowPrivate();

    NativeWindowPrivate(const NativeWindowPrivate&) = delete;
    NativeWindowPrivate& operator=(const NativeWindowPrivate&) = delete;

    bool attach(uint64_t parentHandle, bool show);
    void setRect(int32_t x, int32_t y, int32_t width, int32_t height);
    void detach();
    void close();

    uint64_t nativeHandle() const;

private:
    bool ensureViewWindow();
    void applyRect();
    void destroyView();

    HWND m_parentHwnd = nullptr; // 当前 owner：Electron 主窗口，overlay 的定位基准
    HWND m_viewHwnd = nullptr;   // view：浮在主窗口上面的 overlay 弹窗
    int32_t m_rectX = 0;
    int32_t m_rectY = 0;
    int32_t m_rectWidth = 0;
    int32_t m_rectHeight = 0;
    bool m_attached = false;
};
