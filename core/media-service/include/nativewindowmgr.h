#pragma once

#include <cstdint>
#include <map>
#include <memory>

class NativeWindow;

// 组件 id：查询/派发统一用它；kMainNativeWindowId 固定指主组件
using NativeWindowId = std::uint32_t;

// 主组件的固定 id：nativeWindow()/create()/close() 传它就直接落到主组件，
// 方便上层不用区分
constexpr NativeWindowId kMainNativeWindowId = 0;

// 可视组件管理器：主组件 + 若干按 id 的附加组件。
//   * Windows 下每个 NativeWindow 的原生窗口是 owner 挂到 Electron 主窗口上的 overlay 弹窗
//     （不是 WS_CHILD 子窗口，否则压不过 Chromium 的合成层）
//   * 主组件 initialize() 时备好对象；
//   * 附加组件在 create(id) 时按需建立，一个 id 一个组件
// 所有操作和析构由调用方安排在同一 UI 线程。
// 析构前停止任务来源、关闭原生窗口，并处理完或清空可能访问管理器的任务。
class NativeWindowMgr
{
    bool m_initialized = false;
    std::unique_ptr<NativeWindow> m_mainNativeWindow;
    std::map<NativeWindowId, std::unique_ptr<NativeWindow>> m_nativeWindows;

    NativeWindow* findNativeWindow(NativeWindowId id);
    void closeNativeWindow(NativeWindowId id);
    void closeNativeWindows();

public:
    NativeWindowMgr();
    ~NativeWindowMgr();

    NativeWindowMgr(const NativeWindowMgr&) = delete;
    NativeWindowMgr& operator=(const NativeWindowMgr&) = delete;

    // UI 线程：准备主组件（幂等），关闭后可以重新初始化
    bool initialize();
    // UI 线程：停止组件查询和创建；对象保留，可重复调
    void stop();

    // UI 线程：主组件；未初始化或已停止时返回 nullptr
    NativeWindow* mainNativeWindow();

    // UI 线程：创建 id 的附加组件对象（幂等，原生窗口在 attach 时按需建）。
    // kMainNativeWindowId 直接返回主组件；未初始化或已停止时返回 nullptr
    NativeWindow* create(NativeWindowId id);
    // UI 线程：取 id 的组件；未创建、未初始化或已停止时返回 nullptr
    NativeWindow* nativeWindow(NativeWindowId id);

    // UI 线程：关闭 id 的原生窗口；stop 后仍可调用
    // 组件对象保留，可以重新 attach；没建过则什么也不做
    void close(NativeWindowId id);
    // 释放附加组件对象；保留主组件槽位，仅关闭其原生窗口。
    void release(NativeWindowId id);
    // UI 线程：停止组件操作，关闭所有原生窗口；组件对象保留
    void closeAll();
};
