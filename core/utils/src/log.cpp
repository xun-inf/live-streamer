#include "utils/log.h"

#include <windows.h>

#include <cstdio>
#include <mutex>
#include <string>

namespace liveutils {
namespace {

std::mutex g_log_mutex;
std::wstring g_log_file;

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

std::string CurrentTimestamp() {
  SYSTEMTIME time{};
  ::GetLocalTime(&time);
  char buffer[32] = {};
  std::snprintf(buffer, sizeof(buffer), "%04u-%02u-%02u %02u:%02u:%02u",
                time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute,
                time.wSecond);
  return buffer;
}

std::string ProcessName() {
  char path[MAX_PATH] = {};
  const DWORD length = ::GetModuleFileNameA(nullptr, path, MAX_PATH);
  const std::string full(path, length);
  const size_t pos = full.find_last_of("\\/");
  return pos == std::string::npos ? full : full.substr(pos + 1);
}

}  // namespace

void SetLogFile(const std::wstring& path) {
  std::lock_guard<std::mutex> lock(g_log_mutex);
  g_log_file = path;
}

void Log(LogLevel level, const std::string& component,
         const std::string& message) {
  const std::string line = CurrentTimestamp() + " [" + ProcessName() + "] [" +
                           LevelName(level) + "] [" + component + "] " +
                           message + "\n";
  std::lock_guard<std::mutex> lock(g_log_mutex);
  std::fputs(line.c_str(), stderr);
  ::OutputDebugStringA(line.c_str());
  if (!g_log_file.empty()) {
    if (FILE* file = _wfopen(g_log_file.c_str(), L"a")) {
      std::fputs(line.c_str(), file);
      std::fclose(file);
    }
  }
}

}