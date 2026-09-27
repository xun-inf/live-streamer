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

    bool connected() const;

    bool Start(const std::string& pipe_name);
    void Stop();

    // 线程安全：由内部线程调用，内部串行化
    bool Send(const std::vector<uint8_t>& msg);

private:
  void AcceptLoop();
  bool ConnectClient(HANDLE pipe);
  void ReadLoop(HANDLE pipe);
  void ClosePipe(HANDLE pipe);

  std::string pipe_name_;
  HANDLE pipe_ = INVALID_HANDLE_VALUE;
  HANDLE stop_event_ = nullptr;
  HANDLE read_event_ = nullptr;
  HANDLE write_event_ = nullptr;
  std::thread thread_;
  std::atomic<bool> running_{false};
  std::atomic<bool> connected_{false};
  std::mutex send_mutex_;
  MessageCallback callback_;
  DisconnectCallback disconnect_callback_;
};