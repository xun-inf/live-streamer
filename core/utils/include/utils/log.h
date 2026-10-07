#pragma once

#include <string>

namespace liveutils {

enum class LogLevel { kDebug, kInfo, kWarn, kError };

// 日志写到 stderr、OutputDebugString 和可选滚动文件；进程内线程安全
void SetLogFile(const std::wstring& path);
void Log(LogLevel level, const std::string& component,
         const std::string& message);

inline void LogDebug(const std::string& component, const std::string& message) {
  Log(LogLevel::kDebug, component, message);
}

inline void LogInfo(const std::string& component, const std::string& message) {
  Log(LogLevel::kInfo, component, message);
}

inline void LogWarn(const std::string& component, const std::string& message) {
  Log(LogLevel::kWarn, component, message);
}

inline void LogError(const std::string& component, const std::string& message) {
  Log(LogLevel::kError, component, message);
}

}  // namespace liveutils
