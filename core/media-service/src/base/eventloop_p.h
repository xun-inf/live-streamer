#pragma once

#include <deque>
#include <functional>
#include <mutex>

#if defined(_WIN32)
#include <windows.h>
#endif

class EventLoopPrivate
{
public:
    EventLoopPrivate() = default;
    ~EventLoopPrivate();

    EventLoopPrivate(const EventLoopPrivate&) = delete;
    EventLoopPrivate& operator=(const EventLoopPrivate&) = delete;

    bool initialize();
    bool run();
    bool postTask(std::function<void()> task);
    void requestQuit();
    void stop();
    bool isCurrentThread() const;

private:
#if defined(_WIN32)
    static LRESULT CALLBACK hostWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) noexcept;
#endif

    void runTasks();
    void fail();

    // 平台资源、线程身份、队列和退出状态共用一把锁。
    mutable std::mutex m_mutex;
#if defined(_WIN32)
    HWND m_hostHwnd = nullptr;
    DWORD m_threadId = 0;
#endif

    std::deque<std::function<void()>> m_tasks;
    bool m_stopped = true;
    bool m_quitRequested = false;
    bool m_running = false;
    bool m_failed = false;
};
