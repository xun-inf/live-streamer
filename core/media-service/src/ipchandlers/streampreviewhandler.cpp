#include "streampreviewhandler.h"

#include "application.h"

Domain StreamPreviewHandler::domain() const
{
    return Domain_StreamPreview;
}

bool StreamPreviewHandler::onIpcMessage(const Envelope& envelope)
{
    auto* app = msApp;
    if (envelope.domain() != Domain_StreamPreview || app == nullptr)
    {
        return false;
    }
    if (envelope.stream_preview_type() == StreamPreviewPayload_ReleaseStreamPreview)
    {
        const auto* body = envelope.stream_preview_as_ReleaseStreamPreview();
        if (body == nullptr)
        {
            return false;
        }
        const uint32_t id = body->id();
        // close 会等待工作线程退出；放到生命周期线程，避免阻塞 IPC 收发和帧归还。
        return app->eventLoop()->postTask([app, id] { app->streamPreviewMgr()->release(id); });
    }
    if (envelope.stream_preview_type() != StreamPreviewPayload_ReleaseVideoFrame)
    {
        return false;
    }
    const auto* body = envelope.stream_preview_as_ReleaseVideoFrame();
    if (body == nullptr || body->token() == 0)
    {
        return false;
    }
    app->streamPreviewMgr()->releaseFrame(body->id(), body->token());
    return true;
}
