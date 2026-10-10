#pragma once

#include "framebuffer.h"
#include "streampreview/streampreview.h"

#include <array>
#include <condition_variable>
#include <mutex>
#include <thread>

class StreamPreviewPrivate
{
public:
    StreamPreviewPrivate(StreamPreview::FrameReady ready, StreamPreview::ErrorCallback error);
    ~StreamPreviewPrivate();
    VideoSubmitResult submitFrame(const VideoFrameView& frame, std::shared_ptr<const void> owner = {});
    void releaseFrame(uint64_t token);
    void close();

private:
    void run();

    StreamPreview::FrameReady m_ready;
    StreamPreview::ErrorCallback m_error;
    std::mutex m_mutex;
    std::mutex m_closeMutex;
    std::mutex m_submitMutex;
    std::condition_variable m_changed;
    std::unique_ptr<VideoFrameBuffer> m_pending;
    std::unique_ptr<VideoFrameBuffer> m_spare;
    std::array<uint64_t, 3> m_inFlight {};
    std::array<uint64_t, 3> m_released {};
    bool m_closed = false;
    std::thread m_worker;
};
