#pragma once

#include "streampreview/streampreview.h"

#include <memory>

class GpuDevicePrivate;

// 只由 presenter 的工作线程访问；实现位于 platform/win。
class GpuDevice
{
    std::unique_ptr<GpuDevicePrivate> d_ptr;

public:
    GpuDevice();
    ~GpuDevice();
    // 无空闲槽位返回 false；设备/转换错误抛异常，调用者停止本 presenter。
    bool present(const VideoFrameView& frame, uint64_t token, SharedVideoFrame& output);
    void release(uint64_t token);
};
