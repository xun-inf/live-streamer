#pragma once

#include "ipchandler.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

class IpcServerPrivate;

// 客户端断开或监听失败时在 IPC 线程上调用；不要在回调里调用 stop。
using DisconnectCallback = std::function<void()>;

class IpcServer
{
    std::unique_ptr<IpcServerPrivate> d_ptr;

public:
    // 回调在构造时绑定且保持不变，可为空。
    // 回调捕获的对象也应比服务器存活更久。
    explicit IpcServer(DisconnectCallback callback = {});
    ~IpcServer();

    IpcServer(const IpcServer&) = delete;
    IpcServer& operator=(const IpcServer&) = delete;

    bool connected() const;

    // 线程安全，可随时注册业务处理器；同一 Domain 的重复注册返回 false，不替换已有 handler。
    // Server 持有 handler 的 shared_ptr，消息在 IPC 线程上交给 onIpcMessage。
    bool registerHandler(std::shared_ptr<IpcHandler> handler);

    // start/stop 由应用生命周期线程串行调用；成功表示监听端点已创建。
    bool start(const std::string& pipeName);
    void stop();

    // 线程安全，按完整帧串行同步发送；连接未建立或正在停机时返回 false。
    bool send(const std::vector<uint8_t>& msg);
};
