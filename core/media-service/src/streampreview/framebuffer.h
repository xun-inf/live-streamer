#pragma once

#include "streampreview/videoframe.h"

#include <memory>

struct VideoFrameBuffer
{
    VideoFrameView frame;
    std::unique_ptr<uint8_t[]> storage;
    std::size_t capacity = 0;
    std::shared_ptr<const void> owner;

    static bool valid(const VideoFrameView& source);
    bool copy(const VideoFrameView& source);
};
