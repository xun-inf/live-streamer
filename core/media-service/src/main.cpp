#include "application.h"

#include <windows.h>

// media-service：Electron 拉起的子进程，提供命名管道服务与本地窗口。
int main(int argc, char** argv) {
  // 认父到别人的窗口要按物理像素摆位：本进程必须自己就是 per-monitor v2 aware，
  // 否则 SetWindowPos 的坐标会被系统 DPI 虚拟化，位置和尺寸全不对
  ::SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  MsApplication app(argc, argv);
  if (!app.Initialize()) {
    return 1;
  }
  return app.Exec() ? 0 : 1;
}