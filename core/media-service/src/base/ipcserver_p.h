#pragma once

#include "ipcserver.h"

#include <atomic>
#include <map>
#include <mutex>
#include <thread>

#if defined(_WIN32)
#include <windows.h>
#endif

class IpcServerPrivate
{
public:
    explicit IpcServerPrivate(DisconnectCallback callback);
    ~IpcServerPrivate();

    IpcServerPrivate(const IpcServerPrivate&) = delete;
    IpcServerPrivate& operator=(const IpcServerPrivate&) = delete;

    bool registerHandler(std::shared_ptr<IpcHandler> handler);
    bool connected() const;
    bool start(const std::string& pipeName);
    void stop();
    bool send(const std::vector<uint8_t>& message);

private:
    // handler 在调用线程执行；Envelope 的底层数据只在本次调用期间有效。
    bool dispatch(const std::vector<uint8_t>& message) const noexcept;

#if defined(_WIN32)
    HANDLE createPipe();
    void acceptLoop(HANDLE firstPipe) noexcept;
    bool connectClient(HANDLE pipe, DWORD* error);
    void readLoop(HANDLE pipe);
    void closePipe(HANDLE pipe);
    void notifyDisconnected() noexcept;

    HANDLE m_pipe = INVALID_HANDLE_VALUE;
    HANDLE m_stopEvent = nullptr;
    HANDLE m_disconnectEvent = nullptr;
    HANDLE m_readEvent = nullptr;
    HANDLE m_writeEvent = nullptr;
#endif

    std::string m_pipeName;
    std::thread m_thread;
    std::atomic<bool> m_running {false};
    std::atomic<bool> m_connected {false};
    // 收发使用独立 OVERLAPPED；该锁只串行化完整帧写入与管道释放。
    std::mutex m_sendMutex;
    const DisconnectCallback m_disconnectCallback;

    std::map<Domain, std::shared_ptr<IpcHandler>> m_handlers;
    mutable std::mutex m_handlerMutex;
};
