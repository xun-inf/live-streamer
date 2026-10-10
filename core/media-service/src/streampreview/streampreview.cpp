#include "streampreview/streampreview.h"
#include "streampreview_p.h"
#include "gpudevice.h"

#include <atomic>
#include <exception>
#include <utility>

StreamPreview::StreamPreview(FrameReady ready, ErrorCallback error)
    : d_ptr(std::make_unique<StreamPreviewPrivate>(std::move(ready), std::move(error)))
{
}

StreamPreview::~StreamPreview() = default;

VideoSubmitResult StreamPreview::submitFrame(const VideoFrameView& frame)
{
    return d_ptr->submitFrame(frame);
}

void StreamPreview::releaseFrame(uint64_t token)
{
    d_ptr->releaseFrame(token);
}

void StreamPreview::close()
{
    d_ptr->close();
}

StreamPreviewPrivate::StreamPreviewPrivate(StreamPreview::FrameReady ready, StreamPreview::ErrorCallback error)
    : m_ready(std::move(ready))
    , m_error(std::move(error))
    , m_worker([this] { run(); })
{
}

StreamPreviewPrivate::~StreamPreviewPrivate()
{
    close();
}

VideoSubmitResult StreamPreviewPrivate::submitFrame(const VideoFrameView& frame)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_closed)
    {
        return VideoSubmitResult::Closed;
    }
    auto buffer = std::make_unique<VideoFrameBuffer>();
    if (!buffer->copy(frame))
    {
        return VideoSubmitResult::InvalidFrame;
    }
    m_pending = std::move(buffer);
    m_changed.notify_one();
    return VideoSubmitResult::Accepted;
}

void StreamPreviewPrivate::releaseFrame(uint64_t token)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_closed && m_inFlight.count(token) != 0)
    {
        m_released.insert(token);
        m_changed.notify_one();
    }
}

void StreamPreviewPrivate::close()
{
    std::lock_guard<std::mutex> closeLock(m_closeMutex);
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_closed = true;
        m_pending.reset();
        m_changed.notify_one();
    }
    if (m_worker.joinable())
    {
        m_worker.join();
    }
}

void StreamPreviewPrivate::run()
{
    // 全进程唯一，销毁并重建同一路 presenter 后旧回执不会命中新帧。
    static std::atomic<uint64_t> nextToken {1};
    try
    {
        GpuDevice gpu;
        for (;;)
        {
            std::unique_ptr<VideoFrameBuffer> buffer;
            std::unordered_set<uint64_t> released;
            {
                std::unique_lock<std::mutex> lock(m_mutex);
                m_changed.wait(lock, [this] { return m_closed || m_pending || !m_released.empty(); });
                if (m_closed)
                {
                    return;
                }
                buffer = std::move(m_pending);
                released.swap(m_released);
                for (const auto token : released)
                {
                    m_inFlight.erase(token);
                }
            }
            for (const auto token : released)
            {
                gpu.release(token);
            }
            SharedVideoFrame output;
            if (buffer && gpu.present(buffer->frame, nextToken.fetch_add(1), output))
            {
                {
                    std::lock_guard<std::mutex> lock(m_mutex);
                    m_inFlight.insert(output.token);
                }
                if (!m_ready || !m_ready(output))
                {
                    releaseFrame(output.token);
                }
            }
        }
    }
    catch (const std::exception& error)
    {
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_closed = true;
            m_pending.reset();
        }
        if (m_error)
        {
            m_error(error.what());
        }
    }
}
