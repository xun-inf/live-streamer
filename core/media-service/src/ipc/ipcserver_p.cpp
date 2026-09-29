#include "ipcserver_p.h"

#include "main_generated.h"
#include "utils/log.h"
#include "utils/string_util.h"

const char kComponent[] = "ipc";
constexpr DWORD kPipeBufferSize = 64 * 1024;

// 封包格式：4 字节小端长度前缀 + FlatBuffer 字节
inline constexpr size_t kLengthPrefixSize = 4;
inline constexpr uint32_t kMaxFrameSize = 8 * 1024 * 1024;

// 读写都会循环到满足长度为止：pipe 的一次 ReadFile 可能只返回一部分。
// handle 必须以 FILE_FLAG_OVERLAPPED 打开；abortEvent 触发时放弃本次 I/O，
// 传 nullptr 表示不可中断。
bool ReadFrame(HANDLE handle, HANDLE ioEvent, HANDLE abortEvent,
               std::vector<uint8_t>* out);
bool WriteFrame(HANDLE handle, HANDLE ioEvent, HANDLE abortEvent,
                const uint8_t* data, size_t size);

namespace {

// 等待一次重叠 I/O 完成；abortEvent 触发时取消本次 I/O 并返回 false。
bool WaitForIo(HANDLE handle, OVERLAPPED* overlapped, HANDLE ioEvent,
               HANDLE abortEvent, DWORD* bytes) {
  const HANDLE events[2] = {ioEvent, abortEvent};
  const DWORD count = abortEvent == nullptr ? 1u : 2u;
  const DWORD wait = ::WaitForMultipleObjects(count, events, FALSE, INFINITE);
  if (wait != WAIT_OBJECT_0) {
    ::CancelIoEx(handle, overlapped);
    DWORD ignored = 0;
    ::GetOverlappedResult(handle, overlapped, &ignored, TRUE);
    return false;
  }
  return ::GetOverlappedResult(handle, overlapped, bytes, FALSE) != FALSE;
}

// 读满 size 字节；读到 0 字节（对端关闭）按失败处理。
bool ReadExact(HANDLE handle, HANDLE ioEvent, HANDLE abortEvent, void* out,
               size_t size) {
  auto* cursor = static_cast<uint8_t*>(out);
  size_t remaining = size;
  while (remaining > 0) {
    const DWORD chunk =
        static_cast<DWORD>(remaining > MAXDWORD ? MAXDWORD : remaining);
    OVERLAPPED overlapped{};
    overlapped.hEvent = ioEvent;
    ::ResetEvent(ioEvent);
    DWORD bytes = 0;
    if (!::ReadFile(handle, cursor, chunk, &bytes, &overlapped)) {
      const DWORD error = ::GetLastError();
      if (error != ERROR_IO_PENDING) {
        return false;
      }
      if (!WaitForIo(handle, &overlapped, ioEvent, abortEvent, &bytes)) {
        return false;
      }
    }
    if (bytes == 0) {
      return false;
    }
    cursor += bytes;
    remaining -= bytes;
  }
  return true;
}

// 写满 size 字节。
bool WriteExact(HANDLE handle, HANDLE ioEvent, HANDLE abortEvent,
                const uint8_t* data, size_t size) {
  const uint8_t* cursor = data;
  size_t remaining = size;
  while (remaining > 0) {
    const DWORD chunk =
        static_cast<DWORD>(remaining > MAXDWORD ? MAXDWORD : remaining);
    OVERLAPPED overlapped{};
    overlapped.hEvent = ioEvent;
    ::ResetEvent(ioEvent);
    DWORD bytes = 0;
    if (!::WriteFile(handle, cursor, chunk, &bytes, &overlapped)) {
      const DWORD error = ::GetLastError();
      if (error != ERROR_IO_PENDING) {
        return false;
      }
      if (!WaitForIo(handle, &overlapped, ioEvent, abortEvent, &bytes)) {
        return false;
      }
    }
    if (bytes == 0) {
      return false;
    }
    cursor += bytes;
    remaining -= bytes;
  }
  return true;
}

}  // namespace

bool WriteFrame(HANDLE handle, HANDLE ioEvent, HANDLE abortEvent,
                const uint8_t* data, size_t size) {
  if (size > kMaxFrameSize) {
    return false;
  }
  const uint32_t frameSize = static_cast<uint32_t>(size);
  uint8_t prefix[kLengthPrefixSize] = {};
  prefix[0] = static_cast<uint8_t>(frameSize & 0xFF);
  prefix[1] = static_cast<uint8_t>((frameSize >> 8) & 0xFF);
  prefix[2] = static_cast<uint8_t>((frameSize >> 16) & 0xFF);
  prefix[3] = static_cast<uint8_t>((frameSize >> 24) & 0xFF);
  return WriteExact(handle, ioEvent, abortEvent, prefix, sizeof(prefix)) &&
         WriteExact(handle, ioEvent, abortEvent, data, size);
}

bool ReadFrame(HANDLE handle, HANDLE ioEvent, HANDLE abortEvent,
               std::vector<uint8_t>* out) {
  uint8_t prefix[kLengthPrefixSize] = {};
  if (!ReadExact(handle, ioEvent, abortEvent, prefix, sizeof(prefix))) {
    return false;
  }
  const uint32_t size = static_cast<uint32_t>(prefix[0]) |
                        (static_cast<uint32_t>(prefix[1]) << 8) |
                        (static_cast<uint32_t>(prefix[2]) << 16) |
                        (static_cast<uint32_t>(prefix[3]) << 24);
  if (size > kMaxFrameSize) {
    liveutils::LogError(kComponent, "frame too large: " + std::to_string(size));
    return false;
  }
  out->resize(size);
  return ReadExact(handle, ioEvent, abortEvent, out->data(), size);
}

IpcServerPrivate::~IpcServerPrivate() { 
    Stop(); 
}

bool IpcServerPrivate::Start(const std::string& pipeName) {
  if (m_running.load()) {
    return false;
  }
  m_pipeName = pipeName;
  m_stopEvent = ::CreateEventA(nullptr, TRUE, FALSE, nullptr);
  m_readEvent = ::CreateEventA(nullptr, FALSE, FALSE, nullptr);
  m_writeEvent = ::CreateEventA(nullptr, FALSE, FALSE, nullptr);
  if (m_stopEvent == nullptr || m_readEvent == nullptr ||
      m_writeEvent == nullptr) {
    Stop();
    return false;
  }
  m_running.store(true);
  m_thread = std::thread(&IpcServerPrivate::AcceptLoop, this);
  liveutils::LogInfo(kComponent, "pipe server started: " + pipeName);
  
  return true;
}

void IpcServerPrivate::Stop() {
  if (m_running.exchange(false)) {
    if (m_stopEvent != nullptr) {
      ::SetEvent(m_stopEvent);
    }
    if (m_thread.joinable()) {
      m_thread.join();
    }
  }
  // 线程已退出，不会再有人使用这些句柄
  if (m_stopEvent != nullptr) {
    ::CloseHandle(m_stopEvent);
    m_stopEvent = nullptr;
  }
  if (m_readEvent != nullptr) {
    ::CloseHandle(m_readEvent);
    m_readEvent = nullptr;
  }
  if (m_writeEvent != nullptr) {
    ::CloseHandle(m_writeEvent);
    m_writeEvent = nullptr;
  }
  std::lock_guard<std::mutex> lock(m_sendMutex);
  m_pipe = INVALID_HANDLE_VALUE;  // 已由 AcceptLoop 关闭
  m_connected.store(false);
}

void IpcServerPrivate::AcceptLoop() {
  while (m_running.load()) {
    const HANDLE pipe = ::CreateNamedPipeA(
        m_pipeName.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1, kPipeBufferSize,
        kPipeBufferSize, 0, nullptr);
    if (pipe == INVALID_HANDLE_VALUE) {
      liveutils::LogError(
          kComponent,
          "CreateNamedPipe failed: " +
              liveutils::LastErrorMessage(::GetLastError()));
      break;
    }
    {
      std::lock_guard<std::mutex> lock(m_sendMutex);
      m_pipe = pipe;
    }
    if (!ConnectClient(pipe)) {
      ClosePipe(pipe);
      continue;
    }
    m_connected.store(true);
    liveutils::LogInfo(kComponent, "client connected");
    ReadLoop(pipe);
    m_connected.store(false);
    liveutils::LogInfo(kComponent, "client disconnected");
    if (m_disconnectCallback) {
      m_disconnectCallback();
    }
    ClosePipe(pipe);
  }
  liveutils::LogInfo(kComponent, "pipe server loop exited");
}

bool IpcServerPrivate::ConnectClient(HANDLE pipe) {
  OVERLAPPED overlapped{};
  overlapped.hEvent = m_readEvent;
  ::ResetEvent(m_readEvent);
  if (::ConnectNamedPipe(pipe, &overlapped)) {
    return true;
  }
  const DWORD error = ::GetLastError();
  if (error == ERROR_PIPE_CONNECTED) {
    return true;
  }
  if (error != ERROR_IO_PENDING) {
    liveutils::LogError(
        kComponent,
        "ConnectNamedPipe failed: " + liveutils::LastErrorMessage(error));
    return false;
  }
  const HANDLE handles[2] = {m_readEvent, m_stopEvent};
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
  while (m_running.load()) {
    std::vector<uint8_t> frame;
    if (!ReadFrame(pipe, m_readEvent, m_stopEvent, &frame)) {
      break;
    }
    Dispatch(std::move(frame));
  }
}

bool IpcServerPrivate::Send(const std::vector<uint8_t>& message) {
  std::lock_guard<std::mutex> lock(m_sendMutex);
  if (m_pipe == INVALID_HANDLE_VALUE || !m_connected.load()) {
    return false;
  }
  if (!WriteFrame(m_pipe, m_writeEvent, m_stopEvent, message.data(),
                  message.size())) {
    liveutils::LogWarn(kComponent, "send failed, " +
                                       std::to_string(message.size()) +
                                       " bytes");
    return false;
  }
  return true;
}

void IpcServerPrivate::ClosePipe(HANDLE pipe) {
  std::lock_guard<std::mutex> lock(m_sendMutex);
  if (m_pipe == pipe) {
    m_pipe = INVALID_HANDLE_VALUE;
  }
  ::CloseHandle(pipe);
}

bool IpcServerPrivate::connected() const {
  return m_connected.load();
}

bool IpcServerPrivate::Register(std::shared_ptr<IpcHandler> handler) {
  if (!handler || handler->domain() == Domain_None) {
    liveutils::LogWarn(kComponent, "Register: invalid handler");
    return false;
  }
  const Domain domain = handler->domain();
  std::lock_guard<std::mutex> lock(m_handlersMutex);
  if (!m_handlers.emplace(domain, handler).second) {
    liveutils::LogWarn(kComponent, "Register: domain " +
                                       std::string(EnumNameDomain(domain)) +
                                       " already registered");
    return false;
  }
  return true;
}

IpcHandler* IpcServerPrivate::FindHandler(Domain domain) const {
  std::lock_guard<std::mutex> lock(m_handlersMutex);
  const auto it = m_handlers.find(domain);
  return it != m_handlers.end() ? (it->second).get() : nullptr;
}

// 消息是"4 字节长度前缀 + FlatBuffer"，前缀由 ReadFrame 剥掉，这里只认 Envelope；
// 校验完按 Domain 找注册的 handler 分发：加业务只要注册新的 handler，这里不用动
void IpcServerPrivate::Dispatch(std::vector<uint8_t> message) {
  flatbuffers::Verifier verifier(message.data(), message.size());
  if (!VerifyEnvelopeBuffer(verifier)) {
    liveutils::LogError(kComponent, "invalid message, " +
                                       std::to_string(message.size()) + " bytes");
    return;
  }
  const auto* envelope = GetEnvelope(message.data());
  IpcHandler* handler = FindHandler(envelope->domain());
  if (handler == nullptr) {
    liveutils::LogWarn(kComponent, "no handler for domain " +
                                       std::string(EnumNameDomain(envelope->domain())));
    return;
  }
  if (!handler->OnIpcMessage(*envelope)) {
    liveutils::LogWarn(kComponent, "unhandled message: domain=" +
                                       std::string(EnumNameDomain(envelope->domain())));
  }
}
