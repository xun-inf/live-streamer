#include "application_p.h"

#include "application.h"
#include "ipcserver.h"
#include "utils/log.h"

#include <windows.h>

#include <atomic>
#include <cstdint>
#include <string>
#include <thread>

namespace {

const char kComponent[] = "app";

// 共享 host 窗口：Ctrl+C 与盯父进程的线程靠它投 WM_CLOSE，消息循环收到 WM_QUIT 后收尾
std::atomic<HWND> g_hostWindow{nullptr};

// Ctrl+C / 关控制台：投 WM_CLOSE，消息循环收到 WM_QUIT 后正常收尾
BOOL WINAPI ConsoleHandler(DWORD signal) {
  if (signal == CTRL_C_EVENT || signal == CTRL_CLOSE_EVENT ||
      signal == CTRL_SHUTDOWN_EVENT) {
    const HWND hwnd = g_hostWindow.load();
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
  const HWND hwnd = g_hostWindow.load();
  if (hwnd != nullptr) {
    ::PostMessageW(hwnd, WM_CLOSE, 0, 0);
  }
}

}  // namespace

MsApplicationPrivate::MsApplicationPrivate(MsApplication* app) : m_app(app) {

}

MsApplicationPrivate::~MsApplicationPrivate() {

}

bool MsApplicationPrivate::Initialize(MsConfig* config) {
  m_config = config;
  if (m_config == nullptr || m_config->pipeName().empty()) {
    liveutils::LogError(kComponent, "missing --pipe-name=<name>");
    return false;
  }
  m_parentPid = m_config->parentPid();
  return true;
}

void MsApplicationPrivate::OnClientDisconnected() {
  // Electron 是唯一客户端：管道断了说明它不在了，engine 没有存在的意义
  m_app->windowMgr()->CloseAll();
}

bool MsApplicationPrivate::Exec() {
  if (m_config == nullptr || m_config->pipeName().empty()) {
    liveutils::LogError(kComponent, "engine not initialized, missing --pipe-name");
    return false;
  }
  const std::string pipeName = m_config->pipeName();
  // UI 任务队列和主窗口都由窗口管理器在消息循环线程上立起来
  if (!m_app->windowMgr()->Initialize()) {
    liveutils::LogError(kComponent, "failed to initialize window manager");
    return false;
  }
  g_hostWindow.store(reinterpret_cast<HWND>(
      static_cast<uintptr_t>(m_app->windowMgr()->hostHwnd())));

  ::SetConsoleCtrlHandler(ConsoleHandler, TRUE);
  if (m_parentPid != 0) {
    const DWORD parentPid = static_cast<DWORD>(m_parentPid);
    std::thread(WatchParent, parentPid).detach();
    liveutils::LogInfo(kComponent,
                       "watching parent pid=" + std::to_string(parentPid));
  }

  // 断开回调要在 Start 之前挂好
  m_app->ipcServer()->SetDisconnectCallback([this] { OnClientDisconnected(); });
  if (!m_app->ipcServer()->Start(pipeName)) {
    liveutils::LogError(kComponent, "failed to start pipe server: " + pipeName);
    return false;
  }
  liveutils::LogInfo(kComponent,
                     "media service running, pid=" +
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

  g_hostWindow.store(nullptr);
  m_app->windowMgr()->Stop();
  m_app->ipcServer()->Stop();

  liveutils::LogInfo(kComponent, "media service stopped");
  return true;
}

