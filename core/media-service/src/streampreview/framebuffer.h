#pragma once

#include "streampreview/videoframe.h"

#include <vector>

struct VideoFrameBuffer
{
    VideoFrameView frame;
    std::array<std::vector<uint8_t>, 3> storage;

    bool copy(const VideoFrameView& source);
};
