#pragma once
#include "ipcserver.h"

#include <windows.h>

#include <atomic>
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
    void SetMessageCallback(MessageCallback callback) {
      m_callback = std::move(callback);
    }

    // 必须在 Start 之前设置
    void SetDisconnectCallback(DisconnectCallback callback) {
      m_disconnectCallback = std::move(callback);
    }

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

  std::string m_pipeName;
  HANDLE m_pipe = INVALID_HANDLE_VALUE;
  HANDLE m_stopEvent = nullptr;
  HANDLE m_readEvent = nullptr;
  HANDLE m_writeEvent = nullptr;
  std::thread m_thread;
  std::atomic<bool> m_running{false};
  std::atomic<bool> m_connected{false};
  std::mutex m_sendMutex;
  MessageCallback m_callback;
  DisconnectCallback m_disconnectCallback;
};
