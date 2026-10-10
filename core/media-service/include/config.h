#pragma once

#include <string>

// 命令行配置：media-service 由 Electron 拉起，参数都在命令行里
class Config
{
public:
    Config(int argc, char** argv);
    ~Config();

    // 命名管道名（\\.\pipe\xxx）
    std::string pipeName();

    // 可选日志文件路径（UTF-8）；空路径表示仅输出到控制台和调试器。
    const std::string& logPath() const;

private:
    std::string m_pipeName;
    std::string m_logPath;
};
