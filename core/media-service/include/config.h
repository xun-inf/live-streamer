#pragma once

#include <string>

// 命令行配置：media-service 由 Electron 拉起，参数都在命令行里
class MsConfig {
public:
    MsConfig(int argc, char** argv);
    ~MsConfig();

    // 命名管道名（\\.\pipe\xxx）
    std::string pipeName();
    // 拉起我们的 Electron 主进程 pid；0 表示没传
    unsigned long parentPid();

private:
    std::string m_pipeName;
    unsigned long m_parentPid = 0;
};