#include "utils/logger.h"

#if defined(_WIN32)
#include <windows.h>
#endif

#include <exception>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <spdlog/logger.h>
#if defined(_WIN32)
#include <spdlog/sinks/msvc_sink.h>
#endif
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/sinks/stdout_sinks.h>

namespace liveutils
{
namespace
{

constexpr size_t kMaxLogFileSize = 10 * 1024 * 1024;
constexpr size_t kMaxLogFiles = 5;

const char* levelName(LogLevel level)
{
    switch (level)
    {
    case LogLevel::kDebug:
        return "DEBUG";
    case LogLevel::kInfo:
        return "INFO";
    case LogLevel::kWarn:
        return "WARN";
    case LogLevel::kError:
        return "ERROR";
    }
    return "INFO";
}

spdlog::level::level_enum spdlogLevel(LogLevel level)
{
    switch (level)
    {
    case LogLevel::kDebug:
        return spdlog::level::debug;
    case LogLevel::kInfo:
        return spdlog::level::info;
    case LogLevel::kWarn:
        return spdlog::level::warn;
    case LogLevel::kError:
        return spdlog::level::err;
    }
    return spdlog::level::info;
}

std::string processName()
{
#if defined(_WIN32)
    std::vector<wchar_t> path(MAX_PATH);
    for (;;)
    {
        const DWORD length = ::GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
        if (length == 0)
        {
            return "live-streamer";
        }
        if (length < path.size())
        {
            const auto name = std::filesystem::path(path.data(), path.data() + length).filename().u8string();
            return std::string(name.begin(), name.end());
        }
        path.resize(path.size() * 2);
    }
#elif defined(__linux__)
    std::error_code error;
    const auto path = std::filesystem::read_symlink("/proc/self/exe", error);
    if (!error)
    {
        const auto name = path.filename().u8string();
        return std::string(name.begin(), name.end());
    }
    return "live-streamer";
#else
    return "live-streamer";
#endif
}

std::unique_ptr<spdlog::logger> createLogger(const std::string& logFile)
{
    std::vector<spdlog::sink_ptr> sinks;
    sinks.emplace_back(std::make_shared<spdlog::sinks::stderr_sink_mt>());
#if defined(_WIN32)
    sinks.emplace_back(std::make_shared<spdlog::sinks::msvc_sink_mt>());
#endif
    if (!logFile.empty())
    {
        // char8_t 明确按 UTF-8 解码；native() 仅在 Windows 下转换成宽字符路径。
        const std::filesystem::path path(std::u8string(logFile.begin(), logFile.end()));
        sinks.emplace_back(std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
            path.native(), kMaxLogFileSize, kMaxLogFiles));
    }

    auto logger = std::make_unique<spdlog::logger>(processName(), sinks.begin(), sinks.end());
    logger->set_pattern("%Y-%m-%d %H:%M:%S [%n] %v");
    logger->set_level(spdlog::level::debug);
    logger->flush_on(spdlog::level::debug);
    return logger;
}

} // namespace

class LoggerPrivate
{
public:
    std::mutex mutex;
    std::unique_ptr<spdlog::logger> logger = createLogger({});
};

Logger::Logger(const std::string& path) : d_ptr(std::make_unique<LoggerPrivate>())
{
    if (!path.empty())
    {
        setLogFile(path);
    }
}

Logger::~Logger() = default;

bool Logger::setLogFile(const std::string& path)
{
    // 重配置和写日志共用实例锁，避免同一文件的新旧 sink 并发写入或轮转。
    std::lock_guard<std::mutex> lock(d_ptr->mutex);
    try
    {
        d_ptr->logger = createLogger(path);
        return true;
    }
    catch (const std::exception& error)
    {
        d_ptr->logger->error("[ERROR] [log] failed to open log file: {}", error.what());
        return false;
    }
}

void Logger::log(LogLevel level, const std::string& component, const std::string& message) const
{
    std::lock_guard<std::mutex> lock(d_ptr->mutex);
    d_ptr->logger->log(spdlogLevel(level), "[{}] [{}] {}", levelName(level), component, message);
}

} // namespace liveutils
