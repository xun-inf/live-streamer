#pragma once
#include "ipcserver.h"

#include "ipchandler.h"

#include <windows.h>

#include <atomic>
#include <map>
#include <mutex>
#include <thread>
#include <utility>

class IpcServerPrivate {
public:
    IpcServerPrivate() = default;
    ~IpcServerPrivate();

    IpcServerPrivate(const IpcServerPrivate&) = delete;
    IpcServerPrivate& operator=(const IpcServerPrivate&) = delete;

    // 必须在 Start 之前设置
    void SetDisconnectCallback(DisconnectCallback callback) {
      m_disconnectCallback = std::move(callback);
    }

    // 线程安全：注册一个域；同一个域只能注册一个。handler 由调用方持有
    bool Register(std::shared_ptr<IpcHandler> handler);

    bool connected() const;

    bool Start(const std::string& pipeName);
    void Stop();

    // 线程安全：由内部线程调用，内部串行化
    bool Send(const std::vector<uint8_t>& msg);

private:
  void AcceptLoop();
  bool ConnectClient(HANDLE pipe);
  void ReadLoop(HANDLE pipe);
  void ClosePipe(HANDLE pipe);

  // 收到的帧：校验 FlatBuffer 后按 domain 转给注册的 handler（IPC 线程上执行）
  void Dispatch(std::vector<uint8_t> message);
  // 查注册表；IPC 线程读、注册/反注册随时写，内部加锁
  IpcHandler* FindHandler(Domain domain) const;

  std::string m_pipeName;
  HANDLE m_pipe = INVALID_HANDLE_VALUE;
  HANDLE m_stopEvent = nullptr;
  HANDLE m_readEvent = nullptr;
  HANDLE m_writeEvent = nullptr;
  std::thread m_thread;
  std::atomic<bool> m_running{false};
  std::atomic<bool> m_connected{false};
  std::mutex m_sendMutex;
  DisconnectCallback m_disconnectCallback;

  // 业务域 -> handler；handler 的生命周期由注册方持有
  std::map<Domain, std::shared_ptr<IpcHandler>> m_handlers;
  mutable std::mutex m_handlersMutex;
};
