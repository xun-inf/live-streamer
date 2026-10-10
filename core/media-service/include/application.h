#pragma once

#include "config.h"
#include "ipcserver.h"
#include "eventloop.h"
#include "nativewindowmgr.h"
#include "streampreview/streampreviewmgr.h"

class MediaServiceApplication
{
    static MediaServiceApplication* s_instance;

public:
    MediaServiceApplication(int argc, char** argv);
    ~MediaServiceApplication();

    MediaServiceApplication(const MediaServiceApplication&) = delete;
    MediaServiceApplication& operator=(const MediaServiceApplication&) = delete;

    static MediaServiceApplication* instance()
    {
        return MediaServiceApplication::s_instance;
    }

    Config* config()
    {
        return &m_config;
    }

    IpcServer* ipcServer()
    {
        return &m_ipcServer;
    }

    NativeWindowMgr* nativeWindowMgr()
    {
        return &m_nativeWindowMgr;
    }

    EventLoop* eventLoop()
    {
        return &m_eventLoop;
    }

    StreamPreviewMgr* streamPreviewMgr()
    {
        return &m_streamPreviewMgr;
    }

    // initialize、exec 和析构在同一个 UI 线程调用，不在 exec 中重入。
    // 准备事件循环、窗口管理器和业务处理器，可重复调用。
    bool initialize();

    // 每轮运行前须 initialize；运行结束或启动失败后需重新初始化。
    bool exec();

private:
    void cleanup();

    bool m_initialized = false;

    Config m_config;

    // UI 循环必须比 IPC 回调和组件管理器存活更久。
    EventLoop m_eventLoop;

    IpcServer m_ipcServer;

    NativeWindowMgr m_nativeWindowMgr;
    StreamPreviewMgr m_streamPreviewMgr;
};

#define msApp MediaServiceApplication::instance()
