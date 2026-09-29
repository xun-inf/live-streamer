#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <functional>

class IpcHandler;
class IpcServerPrivate;

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
    void SetDisconnectCallback(DisconnectCallback callback);

    bool connected() const;

    // 注册/反注册 IPC 消息处理器：按 handler->domain() 索引，一个域只能注册一个。
    // 注册后该域的消息会在 IPC 线程上转给 handler->OnIpcMessage()。
    // 线程安全；handler 由调用方持有，反注册之后再销毁
    bool Register(std::shared_ptr<IpcHandler> handler);

    bool Start(const std::string& pipeName);
    void Stop();

    // 线程安全：由内部线程调用，内部串行化
    bool Send(const std::vector<uint8_t>& msg);
};