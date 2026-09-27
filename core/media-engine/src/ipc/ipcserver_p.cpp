#include "ipcserver_p.h"

#include "utils/log.h"

const char kComponent[] = "ipc";
constexpr DWORD kPipeBufferSize = 64 * 1024;

// 封包格式：4 字节小端长度前缀 + FlatBuffer 字节
inline constexpr size_t kLengthPrefixSize = 4;
inline constexpr uint32_t kMaxFrameSize = 8 * 1024 * 1024;

// 读写都会循环到满足长度为止：pipe 的一次 ReadFile 可能只返回一部分。
// handle 必须以 FILE_FLAG_OVERLAPPED 打开；abort_event 触发时放弃本次 I/O，
// 传 nullptr 表示不可中断。
bool ReadFrame(HANDLE handle, HANDLE io_event, HANDLE abort_event,
               std::vector<uint8_t>* out);
bool WriteFrame(HANDLE handle, HANDLE io_event, HANDLE abort_event,
                const uint8_t* data, size_t size);

IpcServerPrivate::~IpcServerPrivate() { 
    Stop(); 
}

bool IpcServerPrivate::Start(const std::string& pipe_name) {
  if (running_.load()) {
    return false;
  }
  pipe_name_ = pipe_name;
  stop_event_ = ::CreateEventA(nullptr, TRUE, FALSE, nullptr);
  read_event_ = ::CreateEventA(nullptr, FALSE, FALSE, nullptr);
  write_event_ = ::CreateEventA(nullptr, FALSE, FALSE, nullptr);
  if (stop_event_ == nullptr || read_event_ == nullptr ||
      write_event_ == nullptr) {
    Stop();
    return false;
  }
  running_.store(true);
  thread_ = std::thread(&IpcServer::AcceptLoop, this);
  LogInfo(kComponent, "pipe server started: " + pipe_name);
  
  return true;
}

void IpcServerPrivate::Stop() {
  if (running_.exchange(false)) {
    if (stop_event_ != nullptr) {
      ::SetEvent(stop_event_);
    }
    if (thread_.joinable()) {
      thread_.join();
    }
  }
  // 线程已退出，不会再有人使用这些句柄
  if (stop_event_ != nullptr) {
    ::CloseHandle(stop_event_);
    stop_event_ = nullptr;
  }
  if (read_event_ != nullptr) {
    ::CloseHandle(read_event_);
    read_event_ = nullptr;
  }
  if (write_event_ != nullptr) {
    ::CloseHandle(write_event_);
    write_event_ = nullptr;
  }
  std::lock_guard<std::mutex> lock(send_mutex_);
  pipe_ = INVALID_HANDLE_VALUE;  // 已由 AcceptLoop 关闭
  connected_.store(false);
}

void IpcServerPrivate::AcceptLoop() {
  while (running_.load()) {
    const HANDLE pipe = ::CreateNamedPipeA(
        pipe_name_.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1, kPipeBufferSize,
        kPipeBufferSize, 0, nullptr);
    if (pipe == INVALID_HANDLE_VALUE) {
      LogError(kComponent,
               "CreateNamedPipe failed: " + LastErrorMessage(::GetLastError()));
      break;
    }
    {
      std::lock_guard<std::mutex> lock(send_mutex_);
      pipe_ = pipe;
    }
    if (!ConnectClient(pipe)) {
      ClosePipe(pipe);
      continue;
    }
    connected_.store(true);
    LogInfo(kComponent, "client connected");
    ReadLoop(pipe);
    connected_.store(false);
    LogInfo(kComponent, "client disconnected");
    if (disconnect_callback_) {
      disconnect_callback_();
    }
    ClosePipe(pipe);
  }
  LogInfo(kComponent, "pipe server loop exited");
}

bool IpcServerPrivate::ConnectClient(HANDLE pipe) {
  OVERLAPPED overlapped{};
  overlapped.hEvent = read_event_;
  ::ResetEvent(read_event_);
  if (::ConnectNamedPipe(pipe, &overlapped)) {
    return true;
  }
  const DWORD error = ::GetLastError();
  if (error == ERROR_PIPE_CONNECTED) {
    return true;
  }
  if (error != ERROR_IO_PENDING) {
    LogError(kComponent,
             "ConnectNamedPipe failed: " + LastErrorMessage(error));
    return false;
  }
  const HANDLE handles[2] = {read_event_, stop_event_};
  const DWORD wait = ::WaitForMultipleObjects(2, handles, FALSE, INFINITE);
  if (wait != WAIT_OBJECT_0) {
    ::CancelIoEx(pipe, &overlapped);
    DWORD ignored = 0;
    ::GetOverlappedResult(pipe, &overlapped, &ignored, TRUE);
    return false;
  }
  DWORD bytes = 0;
  return ::GetOverlappedResult(pipe, &overlapped, &bytes, TRUE) != FALSE;
}

void IpcServerPrivate::ReadLoop(HANDLE pipe) {
  while (running_.load()) {
    std::vector<uint8_t> frame;
    if (!ReadFrame(pipe, read_event_, stop_event_, &frame)) {
      break;
    }
    if (callback_) {
      callback_(std::move(frame));
    }
  }
}

bool IpcServerPrivate::Send(const std::vector<uint8_t>& message) {
  std::lock_guard<std::mutex> lock(send_mutex_);
  if (pipe_ == INVALID_HANDLE_VALUE || !connected_.load()) {
    return false;
  }
  if (!WriteFrame(pipe_, write_event_, stop_event_, message.data(),
                  message.size())) {
    LogWarn(kComponent,
            "send failed, " + std::to_string(message.size()) + " bytes");
    return false;
  }
  return true;
}

void IpcServerPrivate::ClosePipe(HANDLE pipe) {
  std::lock_guard<std::mutex> lock(send_mutex_);
  if (pipe_ == pipe) {
    pipe_ = INVALID_HANDLE_VALUE;
  }
  ::CloseHandle(pipe);
}