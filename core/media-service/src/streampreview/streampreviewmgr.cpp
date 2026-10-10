#include "streampreview/streampreviewmgr.h"

#include "base/logger.h"
#include "ipcserver.h"

StreamPreviewMgr::StreamPreviewMgr(IpcServer& server) : m_server(server)
{
}

StreamPreviewMgr::~StreamPreviewMgr()
{
    closeAll();
}

std::shared_ptr<StreamPreview> StreamPreviewMgr::create(uint32_t id)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    auto& presenter = m_presenters[id];
    if (!presenter)
    {
        presenter = std::make_shared<StreamPreview>(
            [this, id](const SharedVideoFrame& frame)
            {
                {
                    std::lock_guard<std::mutex> lock(m_mutex);
                    m_frames.emplace(frame.token, PublishedFrame {id, frame.resource});
                }
                flatbuffers::FlatBufferBuilder builder;
                const auto body = CreatePresentVideoFrame(builder, id, frame.token, frame.handle, frame.width,
                                                          frame.height, frame.timestampUs);
                const auto envelope = CreateEnvelope(builder, Domain_StreamPreview, NativeWindowPayload_NONE, 0,
                                                      StreamPreviewPayload_PresentVideoFrame, body.Union());
                builder.Finish(envelope);
                const bool sent = m_server.send({builder.GetBufferPointer(), builder.GetBufferPointer() + builder.GetSize()});
                if (!sent)
                {
                    std::lock_guard<std::mutex> lock(m_mutex);
                    m_frames.erase(frame.token);
                }
                return sent;
            },
            [id](const std::string& message)
            {
                mediaservice::logger().logError("streampreview", std::to_string(id) + ": " + message);
            });
    }
    return presenter;
}

void StreamPreviewMgr::release(uint32_t id)
{
    std::shared_ptr<StreamPreview> presenter;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        const auto it = m_presenters.find(id);
        if (it == m_presenters.end())
        {
            return;
        }
        presenter = std::move(it->second);
        m_presenters.erase(it);
    }
    presenter->close();
    // 不移除 m_frames：Electron 可能还未导入或仍在使用已发布的纹理，
    // 必须等对应 ReleaseVideoFrame；token 全局唯一，不影响同 id 的新预览。
}

void StreamPreviewMgr::releaseFrame(uint32_t id, uint64_t token)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    const auto frame = m_frames.find(token);
    if (frame == m_frames.end() || frame->second.id != id)
    {
        return;
    }
    m_frames.erase(frame);
    const auto it = m_presenters.find(id);
    if (it != m_presenters.end())
    {
        it->second->releaseFrame(token);
    }
}

void StreamPreviewMgr::closeAll()
{
    decltype(m_presenters) presenters;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        presenters.swap(m_presenters);
    }
    for (auto& entry : presenters)
    {
        entry.second->close();
    }
    // 只在传输已停止时调用；此时不会再有尚未处理的跨进程导入。
    std::lock_guard<std::mutex> lock(m_mutex);
    m_frames.clear();
}
