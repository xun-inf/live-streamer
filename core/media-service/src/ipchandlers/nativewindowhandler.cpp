#include "nativewindowhandler.h"

#include "application.h"
#include "base/logger.h"
#include "nativewindow.h"

#include <string>

namespace
{

const char kComponent[] = "nativewindow";

} // namespace

NativeWindowHandler::NativeWindowHandler() = default;

Domain NativeWindowHandler::domain() const
{
    return Domain_NativeWindow;
}

// IPC 线程先复制消息字段，再通过 EventLoop 投递；执行任务时才按 id 查询或创建组件。
// Application 会先停止 IPC，再关闭组件并清空事件循环，保证任务里的 app 指针有效。
bool NativeWindowHandler::onIpcMessage(const Envelope& envelope)
{
    auto* app = msApp;
    if (envelope.domain() != Domain_NativeWindow || app == nullptr)
    {
        return false;
    }
    switch (envelope.native_window_type())
    {
    case NativeWindowPayload_AttachNativeWindow:
    {
        const auto* body = envelope.native_window_as_AttachNativeWindow();
        if (body == nullptr)
        {
            return false;
        }
        const NativeWindowId id = body->id();
        const uint64_t parentHandle = body->parent_handle();
        const bool show = body->show();
        if (!app->eventLoop()->postTask(
                [app, id, parentHandle, show]
                {
                    NativeWindow* nativeWindow = app->nativeWindowMgr()->create(id);
                    if (nativeWindow != nullptr && nativeWindow->attach(parentHandle, show))
                    {
                        mediaservice::logger().logInfo(kComponent, "native window " + std::to_string(id) + " attached");
                    }
                }))
        {
            mediaservice::logger().logWarn(kComponent, "postTask(AttachNativeWindow) failed");
        }
        return true;
    }
    case NativeWindowPayload_SetNativeWindowRect:
    {
        const auto* body = envelope.native_window_as_SetNativeWindowRect();
        if (body == nullptr)
        {
            return false;
        }
        const NativeWindowId id = body->id();
        const int32_t x = body->x();
        const int32_t y = body->y();
        const int32_t width = body->width();
        const int32_t height = body->height();
        if (!app->eventLoop()->postTask(
                [app, id, x, y, width, height]
                {
                    NativeWindow* nativeWindow = app->nativeWindowMgr()->nativeWindow(id);
                    if (nativeWindow != nullptr)
                    {
                        nativeWindow->setRect(x, y, width, height);
                    }
                }))
        {
            mediaservice::logger().logWarn(kComponent, "postTask(SetNativeWindowRect) failed");
        }
        return true;
    }
    case NativeWindowPayload_DetachNativeWindow:
    {
        const auto* body = envelope.native_window_as_DetachNativeWindow();
        if (body == nullptr)
        {
            return false;
        }
        const NativeWindowId id = body->id();
        if (!app->eventLoop()->postTask(
                [app, id]
                {
                    NativeWindow* nativeWindow = app->nativeWindowMgr()->nativeWindow(id);
                    if (nativeWindow != nullptr)
                    {
                        nativeWindow->detach();
                    }
                }))
        {
            mediaservice::logger().logWarn(kComponent, "postTask(DetachNativeWindow) failed");
        }
        return true;
    }
    case NativeWindowPayload_ReleaseNativeWindow:
    {
        const auto* body = envelope.native_window_as_ReleaseNativeWindow();
        if (body == nullptr) return false;
        const NativeWindowId id = body->id();
        return app->eventLoop()->postTask([app, id] { app->nativeWindowMgr()->release(id); });
    }
    default:
        return false;
    }
}
