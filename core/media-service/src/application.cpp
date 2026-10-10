#include "application.h"

#include "ipchandlers/ipchandlers.h"
#include "base/logger.h"
#include "utils/scopeguard.h"

#include <cstdio>
#include <string>

namespace
{

const char kComponent[] = "app";

} // namespace

MediaServiceApplication* MediaServiceApplication::s_instance = nullptr;

MediaServiceApplication::MediaServiceApplication(int argc, char** argv)
    : m_config(argc, argv)
    , m_ipcServer([this] { m_eventLoop.requestQuit(); })
    , m_streamPreviewMgr(m_ipcServer)
{
    mediaservice::logger().setLogFile(m_config.logPath());
    MediaServiceApplication::s_instance = this;
}

MediaServiceApplication::~MediaServiceApplication()
{
    cleanup();
    if (s_instance == this)
    {
        s_instance = nullptr;
    }
}

bool MediaServiceApplication::initialize()
{
    if (m_config.pipeName().empty())
    {
        mediaservice::logger().logError(kComponent, "missing --pipe-name=<name>");
        return false;
    }
    if (m_initialized)
    {
        return true;
    }
    auto cleanupGuard = liveutils::makeScopeGuard([this] { cleanup(); });
    if (!m_eventLoop.initialize())
    {
        mediaservice::logger().logError(kComponent, "failed to initialize event loop");
        return false;
    }
    if (!m_nativeWindowMgr.initialize())
    {
        mediaservice::logger().logError(kComponent, "failed to initialize native window manager");
        return false;
    }
    if (!registerIpcHandlers(m_ipcServer))
    {
        return false;
    }

    m_initialized = true;
    cleanupGuard.dismiss();
    return true;
}

bool MediaServiceApplication::exec()
{
    if (!m_initialized)
    {
        mediaservice::logger().logError(kComponent, "media service not initialized");
        return false;
    }

    // 启动失败或抛出异常时，保证清理 IPC 和 UI 资源。
    auto cleanupGuard = liveutils::makeScopeGuard([this] { cleanup(); });

    const std::string pipeName = m_config.pipeName();
    if (!m_ipcServer.start(pipeName))
    {
        mediaservice::logger().logError(kComponent, "failed to start pipe server: " + pipeName);
        return false;
    }
    // stdout 只用于启动就绪通知；日志继续写入 stderr 和日志文件。
    std::fputs("READY\n", stdout);
    std::fflush(stdout);
    mediaservice::logger().logInfo(kComponent, "media service running");

    const bool succeeded = m_eventLoop.run();
    cleanup();
    cleanupGuard.dismiss();
    mediaservice::logger().logInfo(kComponent, "media service stopped");
    return succeeded;
}

void MediaServiceApplication::cleanup()
{
    // 停止并等待 IPC 后，再由 UI 线程关闭窗口和清空事件循环。
    m_ipcServer.stop();
    m_streamPreviewMgr.closeAll();
    m_nativeWindowMgr.closeAll();
    m_eventLoop.stop();
    m_initialized = false;
}
