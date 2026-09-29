#include "ntwindowmgr_p.h"

#include "ntwindow.h"
#include "utils/log.h"

#include <string>
#include <utility>

namespace {

const char kComponent[] = "window";
const wchar_t kHostClass[] = L"NtWindowMgrHost";
// host 窗口的内部消息：叫醒 UI 线程去跑队列里的任务
constexpr UINT kMsgRunTask = WM_APP + 1;

LRESULT CALLBACK HostWndProc(HWND hwnd, UINT message, WPARAM wparam,
                             LPARAM lparam) {
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lparam);
    ::SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(create->lpCreateParams));
  }
  switch (message) {
    case kMsgRunTask: {
      auto* self = reinterpret_cast<NtWindowMgrPrivate*>(
          ::GetWindowLongPtrW(hwnd, GWLP_USERDATA));
      if (self != nullptr) {
        self->RunTasks();
      }
      return 0;
    }
    case WM_CLOSE:
      ::DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      ::PostQuitMessage(0);
      return 0;
    default:
      return ::DefWindowProcW(hwnd, message, wparam, lparam);
  }
}

bool EnsureHostClass() {
  static bool registered = false;
  if (registered) {
    return true;
  }
  WNDCLASSEXW hostClass{};
  hostClass.cbSize = sizeof(hostClass);
  hostClass.lpfnWndProc = HostWndProc;
  hostClass.hInstance = ::GetModuleHandleW(nullptr);
  hostClass.lpszClassName = kHostClass;
  if (::RegisterClassExW(&hostClass) == 0 &&
      ::GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    return false;
  }
  registered = true;
  return true;
}

}  // namespace

NtWindowMgrPrivate::NtWindowMgrPrivate() {

}

NtWindowMgrPrivate::~NtWindowMgrPrivate() {
  DestroyHostWindow();
}

bool NtWindowMgrPrivate::Initialize() {
  if (!CreateHostWindow()) {
    return false;
  }
  // 主窗口对象和 host 一起就位；view 窗口等 Attach 时再建
  if (m_mainWindow == nullptr) {
    m_mainWindow = std::make_unique<NtWindow>();
  }
  return true;
}

void NtWindowMgrPrivate::Stop() {
  std::lock_guard<std::mutex> lock(m_taskMutex);
  m_tasksStopped = true;
  m_tasks.clear();
}

uint64_t NtWindowMgrPrivate::hostHwnd() const {
  return static_cast<uint64_t>(reinterpret_cast<uintptr_t>(m_hostHwnd));
}

NtWindow* NtWindowMgrPrivate::mainWindow() {
  return m_mainWindow.get();
}

NtWindow* NtWindowMgrPrivate::Create(NtWindowId id) {
  // 主窗口一直存在，也不占 map 槽位
  if (id == kMainWindowId) {
    return m_mainWindow.get();
  }
  auto it = m_windows.find(id);
  if (it == m_windows.end()) {
    if (m_mainWindow == nullptr) {
      return nullptr;
    }
    it = m_windows.emplace(id, std::make_unique<NtWindow>()).first;
  }
  return it->second.get();
}

NtWindow* NtWindowMgrPrivate::window(NtWindowId id) {
  if (id == kMainWindowId) {
    return m_mainWindow.get();
  }
  const auto it = m_windows.find(id);
  return it != m_windows.end() ? it->second.get() : nullptr;
}

void NtWindowMgrPrivate::Close(NtWindowId id) {
  NtWindow* target = window(id);
  if (target != nullptr) {
    target->Close();
  }
}

void NtWindowMgrPrivate::CloseAll() {
  // 退出路上先丢掉没跑的任务，免得任务再碰正在关的窗口
  Stop();
  if (m_mainWindow != nullptr) {
    m_mainWindow->Close();
  }
  for (auto& entry : m_windows) {
    entry.second->Close();
  }
  // host 收到 WM_CLOSE 后销毁，消息循环随之收到 WM_QUIT，进程正常收尾
  if (m_hostHwnd != nullptr && ::IsWindow(m_hostHwnd)) {
    ::PostMessageW(m_hostHwnd, WM_CLOSE, 0, 0);
  }
}

bool NtWindowMgrPrivate::PostTask(std::function<void()> task) {
  if (m_hostHwnd == nullptr) {
    return false;
  }
  {
    std::lock_guard<std::mutex> lock(m_taskMutex);
    if (m_tasksStopped) {
      return false;
    }
    m_tasks.push_back(std::move(task));
  }
  // 唤醒失败就把任务留在队列里，等下一次成功唤醒时一起跑
  return ::PostMessageW(m_hostHwnd, kMsgRunTask, 0, 0) != FALSE;
}

bool NtWindowMgrPrivate::PostTask(NtWindowId id,
                                  std::function<void(NtWindow*)> task) {
  // 按 id 派发：轮到执行时才查窗口，窗口已经关了就直接跳过
  return PostTask([this, id, task = std::move(task)] {
    NtWindow* target = window(id);
    if (target != nullptr) {
      task(target);
    }
  });
}

void NtWindowMgrPrivate::RunTasks() {
  std::deque<std::function<void()>> tasks;
  {
    std::lock_guard<std::mutex> lock(m_taskMutex);
    tasks.swap(m_tasks);
  }
  for (auto& task : tasks) {
    task();
  }
}

bool NtWindowMgrPrivate::CreateHostWindow() {
  if (m_hostHwnd != nullptr) {
    if (::IsWindow(m_hostHwnd)) {
      return true;
    }
    // 窗口已经没了（上次 Close() 之后销毁）：清掉残留句柄，按新建处理
    m_hostHwnd = nullptr;
  }
  if (!EnsureHostClass()) {
    return false;
  }
  // 隐藏的 host 窗口：不显示，只做 UI 任务的唤醒目标和退出信号的载体
  m_hostHwnd = ::CreateWindowExW(0, kHostClass, L"", WS_POPUP, 0, 0, 1, 1,
                                 nullptr, nullptr, ::GetModuleHandleW(nullptr),
                                 this);
  if (m_hostHwnd == nullptr) {
    liveutils::LogError(kComponent, "CreateWindowEx(host) failed: " +
                                        std::to_string(::GetLastError()));
  }
  return m_hostHwnd != nullptr;
}

void NtWindowMgrPrivate::DestroyHostWindow() {
  if (m_hostHwnd != nullptr) {
    if (::IsWindow(m_hostHwnd)) {
      ::DestroyWindow(m_hostHwnd);
    }
    m_hostHwnd = nullptr;
  }
}