#include <node_api.h>
#include <windows.h>

#include <cstdint>
#include <cstring>

namespace
{

// 不链接 node.lib，避免对 node.exe/electron.exe 文件名及 delay-load hook 的依赖。
#define NODE_API(name) reinterpret_cast<decltype(&name)>(::GetProcAddress(::GetModuleHandleW(nullptr), #name))

napi_value fail(napi_env env, const char* message)
{
    NODE_API(napi_throw_error)(env, nullptr, message);
    return nullptr;
}

napi_value duplicate(napi_env env, napi_callback_info info)
{
    napi_value args[2];
    size_t count = 2;
    uint32_t pid = 0;
    uint64_t source = 0;
    bool lossless = false;
    if (NODE_API(napi_get_cb_info)(env, info, &count, args, nullptr, nullptr) != napi_ok || count != 2 ||
        NODE_API(napi_get_value_uint32)(env, args[0], &pid) != napi_ok || pid == 0 ||
        NODE_API(napi_get_value_bigint_uint64)(env, args[1], &source, &lossless) != napi_ok || !lossless || source == 0)
    {
        return fail(env, "Invalid source process or texture handle");
    }
    const HANDLE process = ::OpenProcess(PROCESS_DUP_HANDLE, FALSE, pid);
    if (!process)
    {
        return fail(env, "OpenProcess(PROCESS_DUP_HANDLE) failed");
    }
    HANDLE local = nullptr;
    const BOOL copied = ::DuplicateHandle(process, reinterpret_cast<HANDLE>(static_cast<uintptr_t>(source)),
                                          ::GetCurrentProcess(), &local, 0, FALSE, DUPLICATE_SAME_ACCESS);
    ::CloseHandle(process);
    if (!copied)
    {
        return fail(env, "DuplicateHandle failed");
    }
    napi_value value;
    if (NODE_API(napi_create_buffer_copy)(env, sizeof(local), &local, nullptr, &value) != napi_ok)
    {
        ::CloseHandle(local);
        return nullptr;
    }
    return value;
}

napi_value close(napi_env env, napi_callback_info info)
{
    napi_value arg;
    size_t count = 1;
    bool isBuffer = false;
    void* data = nullptr;
    size_t size = 0;
    if (NODE_API(napi_get_cb_info)(env, info, &count, &arg, nullptr, nullptr) != napi_ok || count != 1 ||
        NODE_API(napi_is_buffer)(env, arg, &isBuffer) != napi_ok || !isBuffer ||
        NODE_API(napi_get_buffer_info)(env, arg, &data, &size) != napi_ok || size != sizeof(HANDLE))
    {
        return fail(env, "Invalid local texture handle");
    }
    HANDLE handle = nullptr;
    std::memcpy(&handle, data, sizeof(handle));
    if (handle)
    {
        ::CloseHandle(handle);
        std::memset(data, 0, sizeof(handle));
    }
    napi_value result;
    NODE_API(napi_get_undefined)(env, &result);
    return result;
}

} // namespace

NAPI_MODULE_INIT()
{
    napi_value function;
    NODE_API(napi_create_function)(env, "duplicate", NAPI_AUTO_LENGTH, duplicate, nullptr, &function);
    NODE_API(napi_set_named_property)(env, exports, "duplicate", function);
    NODE_API(napi_create_function)(env, "close", NAPI_AUTO_LENGTH, close, nullptr, &function);
    NODE_API(napi_set_named_property)(env, exports, "close", function);
    return exports;
}
