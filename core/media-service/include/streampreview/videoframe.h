#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

enum class VideoPixelFormat
{
    I420,
    NV12,
    BGRA
};

enum class VideoColorMatrix
{
    BT601,
    BT709
};

struct VideoPlane
{
    const uint8_t* data = nullptr;
    std::size_t stride = 0;
    std::size_t size = 0;
};

// 正 stride；I420 为 Y/U/V，NV12 为 Y/UV，BGRA 为单平面。
// 输入为 SDR；调用期间各平面必须保持有效，submitFrame 返回后即可归还第三方 buffer。
struct VideoFrameView
{
    VideoPixelFormat format = VideoPixelFormat::I420;
    uint32_t width = 0;
    uint32_t height = 0;
    std::array<VideoPlane, 3> planes {};
    int64_t timestampUs = 0;
    VideoColorMatrix matrix = VideoColorMatrix::BT709;
    bool fullRange = false;
};
