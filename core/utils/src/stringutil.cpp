#include "utils/stringutil.h"

#if defined(_WIN32)
#include "utils/scopeguard.h"

#include <windows.h>
#endif

#include <cstdint>
#include <cstdio>

namespace liveutils
{

std::string hResultToText(long hresult)
{
    char code[16] = {};
    const auto error = static_cast<std::uint32_t>(hresult);
    std::snprintf(code, sizeof(code), "0x%08lX", static_cast<unsigned long>(error));
    return std::string(code) + " (" + lastErrorMessage(error) + ")";
}

std::string lastErrorMessage(unsigned long error_code)
{
    std::string message;
#if defined(_WIN32)
    wchar_t* buffer = nullptr;
    auto releaseBuffer = makeScopeGuard(
        [&]
        {
            if (buffer != nullptr)
            {
                ::LocalFree(buffer);
            }
        });
    const DWORD length = ::FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr,
        error_code, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), reinterpret_cast<wchar_t*>(&buffer), 0, nullptr);
    if (length > 0 && buffer != nullptr)
    {
        const int size = ::WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, buffer, static_cast<int>(length),
                                               nullptr, 0, nullptr, nullptr);
        if (size > 0)
        {
            message.resize(static_cast<size_t>(size));
            if (::WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, buffer, static_cast<int>(length),
                                     message.data(), size, nullptr, nullptr) != size)
            {
                message.clear();
            }
        }
    }
#endif
    while (!message.empty() && (message.back() == '\r' || message.back() == '\n' || message.back() == ' '))
    {
        message.pop_back();
    }
    if (message.empty())
    {
        message = "error " + std::to_string(error_code);
    }
    return message;
}

} // namespace liveutils
