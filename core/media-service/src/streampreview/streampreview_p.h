#pragma once

#include "framebuffer.h"
#include "streampreview/streampreview.h"

#include <condition_variable>
#include <mutex>
#include <thread>
#include <unordered_set>

class StreamPreviewPrivate
{
public:
    StreamPreviewPrivate(StreamPreview::FrameReady ready, StreamPreview::ErrorCallback error);
    ~StreamPreviewPrivate();
    VideoSubmitResult submitFrame(const VideoFrameView& frame);
    void releaseFrame(uint64_t token);
    void close();

private:
    void run();

    StreamPreview::FrameReady m_ready;
    StreamPreview::ErrorCallback m_error;
    std::mutex m_mutex;
    std::mutex m_closeMutex;
    std::condition_variable m_changed;
    std::unique_ptr<VideoFrameBuffer> m_pending;
    std::unordered_set<uint64_t> m_inFlight;
    std::unordered_set<uint64_t> m_released;
    bool m_closed = false;
    std::thread m_worker;
};
