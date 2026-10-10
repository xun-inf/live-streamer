#include "streampreviewhandler.h"

#include "application.h"

Domain StreamPreviewHandler::domain() const
{
    return Domain_StreamPreview;
}

bool StreamPreviewHandler::onIpcMessage(const Envelope& envelope)
{
    if (envelope.domain() != Domain_StreamPreview || msApp == nullptr ||
        envelope.stream_preview_type() != StreamPreviewPayload_ReleaseVideoFrame)
    {
        return false;
    }
    const auto* body = envelope.stream_preview_as_ReleaseVideoFrame();
    if (body == nullptr || body->token() == 0)
    {
        return false;
    }
    msApp->streamPreviewMgr()->releaseFrame(body->id(), body->token());
    return true;
}
