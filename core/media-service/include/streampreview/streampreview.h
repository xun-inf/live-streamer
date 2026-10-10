#pragma once

#include "videoframe.h"

#include <functional>
#include <memory>
#include <string>

class StreamPreviewPrivate;

struct SharedVideoFrame
{
    uint64_t token = 0;
    uint64_t handle = 0; // 生产进程内的 NT HANDLE；消费端必须先 DuplicateHandle。
    uint32_t width = 0;
    uint32_t height = 0;
    int64_t timestampUs = 0;
    // 复制描述时一起持有资源，保证 presenter 关闭后已发布的句柄仍然有效。
    // 消费者归还帧时同时释放此引用；其内部类型不属于公开接口。
    std::shared_ptr<void> resource;
};

enum class VideoSubmitResult
{
    Accepted,
    InvalidFrame,
    Closed
};

// 一个实例对应一路画面，不包含采集、解码、业务 ID 或 Electron 类型。
class StreamPreview
{
    std::unique_ptr<StreamPreviewPrivate> d_ptr;

public:
    // 工作线程回调；不得重入 close/析构，不得抛异常。
    // frameReady 返回 true 后必须最终 releaseFrame；返回 false 表示未交给任何消费者。
    using FrameReady = std::function<bool(const SharedVideoFrame&)>;
    using ErrorCallback = std::function<void(const std::string&)>;

    explicit StreamPreview(FrameReady frameReady, ErrorCallback error = {});
    ~StreamPreview();
    StreamPreview(const StreamPreview&) = delete;
    StreamPreview& operator=(const StreamPreview&) = delete;

    // 线程安全；复制有效像素，最多保留一个待处理帧，新帧替换旧帧。
    // Accepted 表示接受输入，不保证每一帧都显示；GPU 资源耗尽时丢帧。
    VideoSubmitResult submitFrame(const VideoFrameView& frame);
    // 线程安全；只在消费端 GPU 引用全部释放后调用，重复/过期 token 无效。
    void releaseFrame(uint64_t token);
    // 生命周期线程调用，停止并等待工作线程；关闭后不能重新提交。
    void close();
};
