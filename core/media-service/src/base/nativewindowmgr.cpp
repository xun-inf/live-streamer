#include "nativewindowmgr.h"

#include "nativewindow.h"

NativeWindowMgr::NativeWindowMgr() = default;

NativeWindowMgr::~NativeWindowMgr() = default;

bool NativeWindowMgr::initialize()
{
    if (m_initialized)
    {
        return true;
    }
    // 原生窗口仍然等到 attach 时才创建；重新初始化沿用组件对象。
    if (m_mainNativeWindow == nullptr)
    {
        m_mainNativeWindow = std::make_unique<NativeWindow>();
    }
    m_initialized = true;
    return true;
}

void NativeWindowMgr::stop()
{
    m_initialized = false;
}

NativeWindow* NativeWindowMgr::mainNativeWindow()
{
    return m_initialized ? m_mainNativeWindow.get() : nullptr;
}

NativeWindow* NativeWindowMgr::create(NativeWindowId id)
{
    if (!m_initialized)
    {
        return nullptr;
    }
    if (id == kMainNativeWindowId)
    {
        return m_mainNativeWindow.get();
    }
    auto it = m_nativeWindows.find(id);
    if (it == m_nativeWindows.end())
    {
        it = m_nativeWindows.emplace(id, std::make_unique<NativeWindow>()).first;
    }
    return it->second.get();
}

NativeWindow* NativeWindowMgr::findNativeWindow(NativeWindowId id)
{
    if (id == kMainNativeWindowId)
    {
        return m_mainNativeWindow.get();
    }
    const auto it = m_nativeWindows.find(id);
    return it != m_nativeWindows.end() ? it->second.get() : nullptr;
}

NativeWindow* NativeWindowMgr::nativeWindow(NativeWindowId id)
{
    return m_initialized ? findNativeWindow(id) : nullptr;
}

void NativeWindowMgr::closeNativeWindow(NativeWindowId id)
{
    NativeWindow* target = findNativeWindow(id);
    if (target != nullptr)
    {
        target->close();
    }
}

void NativeWindowMgr::close(NativeWindowId id)
{
    closeNativeWindow(id);
}

void NativeWindowMgr::closeNativeWindows()
{
    if (m_mainNativeWindow != nullptr)
    {
        m_mainNativeWindow->close();
    }
    for (auto& entry : m_nativeWindows)
    {
        entry.second->close();
    }
}

void NativeWindowMgr::release(NativeWindowId id)
{
    if (id == kMainNativeWindowId)
    {
        closeNativeWindow(id);
        return;
    }
    m_nativeWindows.erase(id);
}

void NativeWindowMgr::closeAll()
{
    stop();
    closeNativeWindows();
}
