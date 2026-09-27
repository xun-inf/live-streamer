#pragma once

#include <string>

namespace liveutils {

std::wstring Utf8ToWide(const std::string& utf8);
std::string WideToUtf8(const std::wstring& wide);

// 把 GetLastError() 的返回值翻成可读文本，用于日志
std::string LastErrorMessage(unsigned long error_code);

// 把 HRESULT 翻成 "0x887A0001 (消息)"，用于日志
std::string HResultToText(long hresult);

}  // namespace liveutils