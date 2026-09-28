#include "mewindow_p.h"

#include "utils/log.h"

#include <cstdio>
#include <string>

namespace {

const char kComponent[] = "window";
const wchar_t kHostClass[] = L"MeWindowHost";
const wchar_t kViewClass[] = L"MeWindowView";
// 窗口线程的内部消息：把别的线程排过来的任务叫醒执行
constexpr UINT kMsgRunTask = WM_APP + 1;

LRESULT CALLBACK HostWndProc(HWND hwnd, UINT message, WPARAM wparam,
                             LPARAM lparam) {
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lparam);
    ::SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(create->lpCreateParams));
  }
  auto* self = reinterpret_cast<MeWindowPrivate*>(
      ::GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  switch (message) {
    case kMsgRunTask:
      if (self != nullptr) {
        self->RunTasks();
      }
      return 0;
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

LRESULT CALLBACK ViewWndProc(HWND hwnd, UINT message, WPARAM wparam,
                             LPARAM lparam) {
  switch (message) {
    case WM_NCHITTEST:
      // 整块穿透：点击落到父窗口上，交给 Chromium 决定怎么响应
      return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;
    default:
      return ::DefWindowProcW(hwnd, message, wparam, lparam);
  }
}

bool EnsureWindowClasses() {
  static bool registered = false;
  if (registered) {
    return true;
  }
  const HINSTANCE instance = ::GetModuleHandleW(nullptr);
  WNDCLASSEXW hostClass{};
  hostClass.cbSize = sizeof(hostClass);
  hostClass.lpfnWndProc = HostWndProc;
  hostClass.hInstance = instance;
  hostClass.lpszClassName = kHostClass;
  WNDCLASSEXW viewClass{};
  viewClass.cbSize = sizeof(viewClass);
  viewClass.lpfnWndProc = ViewWndProc;
  viewClass.hInstance = instance;
  viewClass.lpszClassName = kViewClass;
  viewClass.hCursor = ::LoadCursorW(nullptr, IDC_ARROW);
  // 画面管线还没接：view 先是一块黑底，擦背景和重绘都交给 DefWindowProc
  viewClass.hbrBackground =
      static_cast<HBRUSH>(::GetStockObject(BLACK_BRUSH));
  for (const WNDCLASSEXW* candidate : {&hostClass, &viewClass}) {
    if (::RegisterClassExW(candidate) == 0 &&
        ::GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
      return false;
    }
  }
  registered = true;
  return true;
}

std::string Hex(uint64_t value) {
  char buffer[32] = {};
  std::snprintf(buffer, sizeof(buffer), "0x%llx",
                static_cast<unsigned long long>(value));
  return buffer;
}

}  // namespace

MeWindowPrivate::~MeWindowPrivate() {
  Destroy();
}

bool MeWindowPrivate::Create() {
  if (m_hwnd != nullptr) {
    return true;
  }
  if (!EnsureWindowClasses()) {
    return false;
  }
  // 隐藏的宿主窗口：不显示，只作为消息队列的锚点、以及 view 没认父时的落点
  m_hwnd = ::CreateWindowExW(0, kHostClass, L"", WS_POPUP, 0, 0, 1, 1, nullptr,
                             nullptr, ::GetModuleHandleW(nullptr), this);
  return m_hwnd != nullptr;
}

void MeWindowPrivate::Close() {
  if (m_hwnd != nullptr) {
    ::PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
  }
}

bool MeWindowPrivate::EnsureViewWindow() {
  if (m_viewHwnd != nullptr) {
    return true;
  }
  if (m_hwnd == nullptr || !EnsureWindowClasses()) {
    return false;
  }
  // 先挂在宿主窗口下，Attach 时再跨进程认父
  m_viewHwnd = ::CreateWindowExW(
      WS_EX_NOACTIVATE | WS_EX_NOPARENTNOTIFY, kViewClass, L"",
      WS_CHILD | WS_CLIPSIBLINGS, 0, 0, 1, 1, m_hwnd, nullptr,
      ::GetModuleHandleW(nullptr), nullptr);
  if (m_viewHwnd == nullptr) {
    liveutils::LogError(kComponent, "CreateWindowEx(view) failed: " +
                                       std::to_string(::GetLastError()));
  }
  return m_viewHwnd != nullptr;
}

bool MeWindowPrivate::Attach(uint64_t parentHwnd, bool show) {
  const HWND parent =
      reinterpret_cast<HWND>(static_cast<uintptr_t>(parentHwnd));
  if (::IsWindow(parent) == FALSE) {
    liveutils::LogError(kComponent,
                        "parent hwnd is not a window: " + Hex(parentHwnd));
    return false;
  }
  if (!EnsureViewWindow()) {
    return false;
  }
  if (::GetParent(m_viewHwnd) != parent) {
    if (::SetParent(m_viewHwnd, parent) == nullptr) {
      liveutils::LogError(kComponent,
                          "SetParent failed: " + std::to_string(::GetLastError()));
      return false;
    }
    if (::GetParent(m_viewHwnd) != parent) {
      liveutils::LogError(kComponent, "SetParent did not take effect");
      return false;
    }
  }
  m_attached = true;
  ApplyRect();
  ::ShowWindow(m_viewHwnd, show ? SW_SHOWNOACTIVATE : SW_HIDE);
  liveutils::LogInfo(kComponent, "view attached to parent " + Hex(parentHwnd));
  return true;
}

void MeWindowPrivate::SetRect(int32_t x, int32_t y, int32_t width,
                              int32_t height) {
  if (width <= 0 || height <= 0) {
    return;
  }
  m_rectX = x;
  m_rectY = y;
  m_rectWidth = width;
  m_rectHeight = height;
  ApplyRect();
}

void MeWindowPrivate::ApplyRect() {
  if (!m_attached || m_viewHwnd == nullptr) {
    return;
  }
  // HWND_TOP：挂在父窗口子窗口链的最上面，盖住 Chromium 自己的呈现层
  ::SetWindowPos(m_viewHwnd, HWND_TOP, m_rectX, m_rectY, m_rectWidth,
                 m_rectHeight, SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

void MeWindowPrivate::Detach() {
  if (m_viewHwnd == nullptr || m_hwnd == nullptr) {
    return;
  }
  ::ShowWindow(m_viewHwnd, SW_HIDE);
  ::SetParent(m_viewHwnd, m_hwnd);
  m_attached = false;
  liveutils::LogInfo(kComponent, "view detached");
}

bool MeWindowPrivate::PostTask(std::function<void()> task) {
  if (m_hwnd == nullptr) {
    return false;
  }
  {
    std::lock_guard<std::mutex> lock(m_taskMutex);
    m_tasks.push_back(std::move(task));
  }
  if (::PostMessageW(m_hwnd, kMsgRunTask, 0, 0) == FALSE) {
    liveutils::LogWarn(kComponent,
                       "PostTask failed: " + std::to_string(::GetLastError()));
    return false;
  }
  return true;
}

void MeWindowPrivate::RunTasks() {
  std::deque<std::function<void()>> tasks;
  {
    std::lock_guard<std::mutex> lock(m_taskMutex);
    tasks.swap(m_tasks);
  }
  for (auto& task : tasks) {
    task();
  }
}

uint64_t MeWindowPrivate::hwnd() const {
  return static_cast<uint64_t>(reinterpret_cast<uintptr_t>(m_hwnd));
}

uint64_t MeWindowPrivate::viewHwnd() const {
  return static_cast<uint64_t>(reinterpret_cast<uintptr_t>(m_viewHwnd));
}

void MeWindowPrivate::Destroy() {
  if (m_viewHwnd != nullptr) {
    if (::IsWindow(m_viewHwnd)) {
      ::DestroyWindow(m_viewHwnd);
    }
    m_viewHwnd = nullptr;
  }
  if (m_hwnd != nullptr) {
    if (::IsWindow(m_hwnd)) {
      ::DestroyWindow(m_hwnd);
    }
    m_hwnd = nullptr;
  }
  std::lock_guard<std::mutex> lock(m_taskMutex);
  m_tasks.clear();
}
