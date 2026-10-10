#pragma once

#include <functional>
#include <memory>

class EventLoopPrivate;

// 事件循环、任务调度与退出管理；平台消息循环和唤醒窗口由私有实现持有。
class EventLoop
{
    std::unique_ptr<EventLoopPrivate> d_ptr;

public:
    EventLoop();
    ~EventLoop();

    EventLoop(const EventLoop&) = delete;
    EventLoop& operator=(const EventLoop&) = delete;

    // initialize、run、stop 及析构在同一个 UI 线程调用。
    bool initialize();
    // 正常退出返回 true；消息循环或任务执行失败返回 false。
    bool run();
    // 任意线程入队；尚未初始化或已请求退出时返回 false。
    bool postTask(std::function<void()> task);
    // 任意线程请求退出；也可在 initialize 后、run 前调用。
    void requestQuit();
    // 丢弃待执行任务并释放平台资源，可重复调用。
    void stop();
    // initialize 成功后至 stop 之前，标识初始化所在的 UI 线程。
    bool isCurrentThread() const;
};
