#pragma once

#include <string>

namespace liveutils
{

// Windows 错误码转换为 UTF-8 文本；其他平台保留数字错误码。
std::string lastErrorMessage(unsigned long error_code);

// 把 HRESULT 翻成 "0x887A0001 (消息)"，用于日志
std::string hResultToText(long hresult);

} // namespace liveutils
