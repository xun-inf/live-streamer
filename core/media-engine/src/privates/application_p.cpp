#include "application_p.h"

#include "handlers/ipchandler.h"
#include "ipcserver.h"
#include "main_generated.h"
#include "utils/log.h"
#include "utils/string_util.h"

#include <windows.h>

#include <atomic>
#include <cstdint>
#include <string>
#include <thread>

namespace {

const char kComponent[] = "app";

// 窗口线程的锚：Ctrl+C 与盯父进程的线程靠它投 WM_CLOSE
std::atomic<HWND> g_mainWindow{nullptr};

std::string ArgValue(int argc, char** argv, const std::string& name) {
  const std::string prefix = "--" + name + "=";
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i] != nullptr ? argv[i] : "";
    if (arg.rfind(prefix, 0) == 0) {
      return arg.substr(prefix.size());
    }
  }
  return std::string();
}

// Ctrl+C / 关控制台：投 WM_CLOSE，消息循环收到 WM_QUIT 后正常收尾
BOOL WINAPI ConsoleHandler(DWORD signal) {
  if (signal == CTRL_C_EVENT || signal == CTRL_CLOSE_EVENT ||
      signal == CTRL_SHUTDOWN_EVENT) {
    const HWND hwnd = g_mainWindow.load();
    if (hwnd != nullptr) {
      ::PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }
    return TRUE;
  }
  return FALSE;
}

// Electron 主进程被强杀时我们得跟着走：Windows 上子进程不会自动陪葬
void WatchParent(DWORD parentPid) {
  const HANDLE parent = ::OpenProcess(SYNCHRONIZE, FALSE, parentPid);
  if (parent == nullptr) {
    return;  // 父进程已经没了 / 拿不到句柄，不挡住自己启动
  }
  ::WaitForSingleObject(parent, INFINITE);
  ::CloseHandle(parent);
  const HWND hwnd = g_mainWindow.load();
  if (hwnd != nullptr) {
    ::PostMessageW(hwnd, WM_CLOSE, 0, 0);
  }
}

}  // namespace

MeApplicationPrivate::MeApplicationPrivate() {

}

MeApplicationPrivate::~MeApplicationPrivate() {

}

bool MeApplicationPrivate::Initialize(int argc, char** argv) {
  const std::string logPath = ArgValue(argc, argv, "log");
  if (!logPath.empty()) {
    liveutils::SetLogFile(liveutils::Utf8ToWide(logPath));
  }

  const std::string pipeName = ArgValue(argc, argv, "pipe-name");
  if (pipeName.empty()) {
    liveutils::LogError(kComponent, "missing --pipe-name=<name>");
    return false;
  }
  m_pipeName = pipeName;

  const std::string parentPid = ArgValue(argc, argv, "parent-pid");
  if (!parentPid.empty()) {
    m_parentPid = std::stoul(parentPid);
  }

  // 引擎自带的 IPC 域处理器在这里挂上（窗口域等）
  InitializeIpcHandlers();
  return true;
}

// 消息是"4 字节长度前缀 + FlatBuffer"，前缀由 IpcServer 剥掉，这里只认 Envelope。
// 校验完按 Domain 找注册的 handler 分发：加业务只要注册新的 handler，这里不用动
void MeApplicationPrivate::OnMessage(std::vector<uint8_t> message) {
  flatbuffers::Verifier verifier(message.data(), message.size());
  if (!VerifyEnvelopeBuffer(verifier)) {
    liveutils::LogError(kComponent, "invalid message, " +
                                       std::to_string(message.size()) + " bytes");
    return;
  }
  const auto* envelope = GetEnvelope(message.data());
  IpcHandler* handler = FindIpcHandler(envelope->domain());
  if (handler == nullptr) {
    liveutils::LogWarn(kComponent, "no handler for domain " +
                                       std::string(EnumNameDomain(envelope->domain())));
    return;
  }
  if (!handler->OnMessage(*envelope)) {
    liveutils::LogWarn(kComponent, "unhandled message: domain=" +
                                       std::string(EnumNameDomain(envelope->domain())));
  }
}

void MeApplicationPrivate::OnClientDisconnected() {
  // Electron 是唯一客户端：管道断了说明它不在了，engine 没有存在的意义
  m_window.Close();
}

bool MeApplicationPrivate::RegisterIpcHandler(IpcHandler* handler) {
  if (handler == nullptr || handler->domain() == Domain_None) {
    liveutils::LogWarn(kComponent, "RegisterIpcHandler: invalid handler");
    return false;
  }
  const Domain domain = handler->domain();
  std::lock_guard<std::mutex> lock(m_handlersMutex);
  if (!m_handlers.emplace(domain, handler).second) {
    liveutils::LogWarn(kComponent, "RegisterIpcHandler: domain " +
                                       std::string(EnumNameDomain(domain)) +
                                       " already registered");
    return false;
  }
  return true;
}

bool MeApplicationPrivate::UnregisterIpcHandler(Domain domain) {
  std::lock_guard<std::mutex> lock(m_handlersMutex);
  return m_handlers.erase(domain) > 0;
}

IpcHandler* MeApplicationPrivate::FindIpcHandler(Domain domain) {
  std::lock_guard<std::mutex> lock(m_handlersMutex);
  const auto it = m_handlers.find(domain);
  return it != m_handlers.end() ? it->second : nullptr;
}

bool MeApplicationPrivate::Exec() {
  if (m_pipeName.empty()) {
    liveutils::LogError(kComponent, "engine not initialized, missing --pipe-name");
    return false;
  }
  // 宿主窗口必须建在跑消息循环的线程上
  if (!m_window.Create()) {
    liveutils::LogError(kComponent, "failed to create host window: " +
                                       std::to_string(::GetLastError()));
    return false;
  }
  g_mainWindow.store(reinterpret_cast<HWND>(
      static_cast<uintptr_t>(m_window.hwnd())));
  ::SetConsoleCtrlHandler(ConsoleHandler, TRUE);
  if (m_parentPid != 0) {
    const DWORD parentPid = static_cast<DWORD>(m_parentPid);
    std::thread(WatchParent, parentPid).detach();
    liveutils::LogInfo(kComponent,
                       "watching parent pid=" + std::to_string(parentPid));
  }

  // 回调要在 Start 之前挂好，否则第一条消息可能被丢掉
  m_ipcServer.SetMessageCallback(
      [this](std::vector<uint8_t> message) { OnMessage(std::move(message)); });
  m_ipcServer.SetDisconnectCallback([this] { OnClientDisconnected(); });
  if (!m_ipcServer.Start(m_pipeName)) {
    liveutils::LogError(kComponent, "failed to start pipe server: " + m_pipeName);
    return false;
  }
  liveutils::LogInfo(kComponent,
                     "media engine running, pid=" +
                         std::to_string(::GetCurrentProcessId()));

  // 标准消息泵：WM_QUIT（宿主窗口销毁时由 WM_DESTROY 投递）到达后退出
  MSG message{};
  BOOL result = 0;
  while ((result = ::GetMessageW(&message, nullptr, 0, 0)) != 0) {
    if (result == -1) {
      liveutils::LogError(kComponent, "GetMessage failed: " +
                                         std::to_string(::GetLastError()));
      break;
    }
    ::TranslateMessage(&message);
    ::DispatchMessageW(&message);
  }

  g_mainWindow.store(nullptr);
  m_ipcServer.Stop();

  liveutils::LogInfo(kComponent, "media engine stopped");
  return true;
}

MeWindow* MeApplicationPrivate::window() {
  return &m_window;
}
