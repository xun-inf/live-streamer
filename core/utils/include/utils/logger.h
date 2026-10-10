#pragma once

#include <memory>
#include <string>

namespace liveutils
{

enum class LogLevel
{
    kDebug,
    kInfo,
    kWarn,
    kError
};

class LoggerPrivate;

// 每个实例独立管理 stderr、OutputDebugString 和可选滚动文件；实例内线程安全。
// 独立实例应使用不同文件路径；同一文件的调用方应共享同一个 Logger。
class Logger
{
public:
    // path 使用 UTF-8；文件打开失败时保留控制台输出，并记录错误。
    explicit Logger(const std::string& path = {});
    ~Logger();

    Logger(const Logger&) = delete;
    Logger& operator=(const Logger&) = delete;

    // path 使用 UTF-8；空路径关闭文件输出；打开失败返回 false，保留原输出配置。
    bool setLogFile(const std::string& path);
    void log(LogLevel level, const std::string& component, const std::string& message) const;

    void logDebug(const std::string& component, const std::string& message) const
    {
        log(LogLevel::kDebug, component, message);
    }

    void logInfo(const std::string& component, const std::string& message) const
    {
        log(LogLevel::kInfo, component, message);
    }

    void logWarn(const std::string& component, const std::string& message) const
    {
        log(LogLevel::kWarn, component, message);
    }

    void logError(const std::string& component, const std::string& message) const
    {
        log(LogLevel::kError, component, message);
    }

private:
    std::unique_ptr<LoggerPrivate> d_ptr;
};

} // namespace liveutils
