#pragma once

#include <cstdint>
#include <memory>

class NativeWindowPrivate;

// 可挂接到 Electron 主窗口的可视组件（四层窗口模式的第 3 层）。
// 当前 Windows 实现采用 WS_POPUP 弹窗，owner 指向 Electron 主窗口：
// Chromium 走 DirectComposition 渲染时子窗口压不上去，弹窗可以；owner 关系保证它
// 一直浮在主窗口上方、随主窗口最小化一起隐藏。host 窗口（退出信号 + 任务泵）由
// EventLoop 维护，本类不管。
// 约束：窗口调用都在窗口线程（跑消息循环的那个线程）上执行；别的线程要用
// EventLoop::postTask() 把任务排过去——跨线程 SetWindowPos 是同步调用，
// 窗口线程不泵消息就会把调用方卡住。
class NativeWindow
{
    std::unique_ptr<NativeWindowPrivate> d_ptr;

public:
    NativeWindow();
    ~NativeWindow();

    NativeWindow(const NativeWindow&) = delete;
    NativeWindow& operator=(const NativeWindow&) = delete;

    // 挂接到消费端主窗口的原生句柄；组件窗口按需创建（Windows 下允许跨进程）
    bool attach(uint64_t parentHandle, bool show);
    // 组件在主窗口客户区坐标系下的物理像素矩形
    void setRect(int32_t x, int32_t y, int32_t width, int32_t height);
    // 从主窗口上摘下来：隐藏组件（原生窗口保留，可以重新 attach）
    void detach();
    // 关闭组件的原生窗口（对象保留，可以重新 attach）；没建过则什么也不做
    void close();

    // 组件的原生句柄；未创建时为 0
    uint64_t nativeHandle() const;
};
