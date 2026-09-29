#include "config.h"

#include "utils/log.h"
#include "utils/string_util.h"

namespace {

std::string ArgValue(int argc, char** argv, const std::string& name) {
  const std::string prefix = "--" + name + "=";
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i] != nullptr ? argv[i] : "";
    if (arg.rfind(prefix, 0) == 0) {
      return arg.substr(prefix.size());
    }
  }
  return std::string();
}

}  // namespace

MsConfig::MsConfig(int argc, char** argv) {
  const std::string logPath = ArgValue(argc, argv, "log");
  if (!logPath.empty()) {
    liveutils::SetLogFile(liveutils::Utf8ToWide(logPath));
  }

  m_pipeName = ArgValue(argc, argv, "pipe-name");

  const std::string parentPid = ArgValue(argc, argv, "parent-pid");
  if (!parentPid.empty()) {
    m_parentPid = std::stoul(parentPid);
  }
}

MsConfig::~MsConfig() {

}

std::string MsConfig::pipeName() {
  return m_pipeName;
}

unsigned long MsConfig::parentPid() {
  return m_parentPid;
}