#pragma once

#include "streampreview.h"

#include <memory>
#include <mutex>
#include <unordered_map>

class IpcServer;

// 可选的现有 IPC 适配器；StreamPreview 本身不依赖它。
// 调用方持有 shared_ptr，release/closeAll 后对象仍有效，但停止接受新帧。
class StreamPreviewMgr
{
public:
    explicit StreamPreviewMgr(IpcServer& server);
    ~StreamPreviewMgr();
    std::shared_ptr<StreamPreview> create(uint32_t id);
    void release(uint32_t id);
    void releaseFrame(uint32_t id, uint64_t token);
    // 应用生命周期线程调用；先停止 IPC，禁止与 create 并发。
    void closeAll();

private:
    IpcServer& m_server;
    std::mutex m_mutex;
    std::unordered_map<uint32_t, std::shared_ptr<StreamPreview>> m_presenters;
    struct PublishedFrame
    {
        uint32_t id;
        std::shared_ptr<void> resource;
    };
    std::unordered_map<uint64_t, PublishedFrame> m_frames;
};
