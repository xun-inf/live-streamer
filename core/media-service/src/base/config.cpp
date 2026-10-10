#include "config.h"

namespace
{

std::string argValue(int argc, char** argv, const std::string& name)
{
    const std::string prefix = "--" + name + "=";
    for (int i = 1; i < argc; ++i)
    {
        const std::string arg = argv[i] != nullptr ? argv[i] : "";
        if (arg.rfind(prefix, 0) == 0)
        {
            return arg.substr(prefix.size());
        }
    }
    return std::string();
}

} // namespace

Config::Config(int argc, char** argv)
{
    m_logPath = argValue(argc, argv, "log");
    m_pipeName = argValue(argc, argv, "pipe-name");
}

Config::~Config()
{
}

std::string Config::pipeName()
{
    return m_pipeName;
}

const std::string& Config::logPath() const
{
    return m_logPath;
}
