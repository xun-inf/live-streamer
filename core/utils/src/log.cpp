#include "utils/log.h"

#include <windows.h>

#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <spdlog/logger.h>
#include <spdlog/sinks/msvc_sink.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/sinks/stdout_sinks.h>
#include <spdlog/spdlog.h>

namespace liveutils {
namespace {

constexpr size_t kMaxLogFileSize = 10 * 1024 * 1024;
constexpr size_t kMaxLogFiles = 5;

std::mutex g_logger_mutex;
std::shared_ptr<spdlog::logger> g_logger;

const char* LevelName(LogLevel level) {
  switch (level) {
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

spdlog::level::level_enum SpdlogLevel(LogLevel level) {
  switch (level) {
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

std::string ProcessName() {
  char path[MAX_PATH] = {};
  const DWORD length = ::GetModuleFileNameA(nullptr, path, MAX_PATH);
  const std::string full(path, length);
  const size_t pos = full.find_last_of("\\/");
  return pos == std::string::npos ? full : full.substr(pos + 1);
}

std::shared_ptr<spdlog::logger> CreateLogger(const std::wstring& logFile) {
  std::vector<spdlog::sink_ptr> sinks;
  sinks.emplace_back(std::make_shared<spdlog::sinks::stderr_sink_mt>());
  sinks.emplace_back(std::make_shared<spdlog::sinks::msvc_sink_mt>());
  if (!logFile.empty()) {
    sinks.emplace_back(std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
        logFile, kMaxLogFileSize, kMaxLogFiles));
  }

  auto logger = std::make_shared<spdlog::logger>(ProcessName(), sinks.begin(),
                                                 sinks.end());
  logger->set_pattern("%Y-%m-%d %H:%M:%S [%n] %v");
  logger->set_level(spdlog::level::debug);
  logger->flush_on(spdlog::level::debug);
  return logger;
}

std::shared_ptr<spdlog::logger> Logger() {
  std::lock_guard<std::mutex> lock(g_logger_mutex);
  if (!g_logger) {
    g_logger = CreateLogger({});
  }
  return g_logger;
}

}  // namespace

void SetLogFile(const std::wstring& path) {
  try {
    auto logger = CreateLogger(path);
    std::lock_guard<std::mutex> lock(g_logger_mutex);
    g_logger = std::move(logger);
  } catch (const spdlog::spdlog_ex& error) {
    Logger()->error("[ERROR] [log] failed to open log file: {}", error.what());
  }
}

void Log(LogLevel level, const std::string& component,
         const std::string& message) {
  Logger()->log(SpdlogLevel(level), "[{}] [{}] {}", LevelName(level),
                component, message);
}

}
