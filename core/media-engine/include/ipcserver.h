#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <functional>

class IpcServerPrivate;

// 消息回调运行在 IPC 线程上：实现里只做入队，不要阻塞
using MessageCallback = std::function<void(std::vector<uint8_t>)>;

// 客户端断开回调（IPC 线程上调用）：实现里只置标志，别做重活
using DisconnectCallback = std::function<void()>;

class IpcServer {
    std::unique_ptr<IpcServerPrivate> d_ptr;

public:
    IpcServer();
    ~IpcServer();

    IpcServer(const IpcServer&) = delete;
    IpcServer& operator=(const IpcServer&) = delete;

    // 必须在 Start 之前设置
    void SetMessageCallback(MessageCallback callback);

    // 必须在 Start 之前设置
    void SetDisconnectCallback(DisconnectCallback callback);

    bool connected() const;

    bool Start(const std::string& pipeName);
    void Stop();

    // 线程安全：由内部线程调用，内部串行化
    bool Send(const std::vector<uint8_t>& msg);
};
