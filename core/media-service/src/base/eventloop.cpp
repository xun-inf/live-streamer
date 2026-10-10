#include "eventloop.h"
#include "eventloop_p.h"

#include <utility>

EventLoop::EventLoop() : d_ptr(std::make_unique<EventLoopPrivate>())
{
}

EventLoop::~EventLoop() = default;

bool EventLoop::initialize()
{
    return d_ptr->initialize();
}

bool EventLoop::run()
{
    return d_ptr->run();
}

bool EventLoop::postTask(std::function<void()> task)
{
    return d_ptr->postTask(std::move(task));
}

void EventLoop::requestQuit()
{
    d_ptr->requestQuit();
}

void EventLoop::stop()
{
    d_ptr->stop();
}

bool EventLoop::isCurrentThread() const
{
    return d_ptr->isCurrentThread();
}
