#pragma once

#include <functional>
#include <utility>

namespace liveutils
{

// 作用域退出时执行一次动作，用于保证资源释放
class ScopeGuard
{
public:
    explicit ScopeGuard(std::function<void()> callback) : callback_(std::move(callback))
    {
    }

    ScopeGuard(const ScopeGuard&) = delete;
    ScopeGuard& operator=(const ScopeGuard&) = delete;

    ScopeGuard(ScopeGuard&& other) noexcept : callback_(std::move(other.callback_)), active_(other.active_)
    {
        other.active_ = false;
    }

    ~ScopeGuard()
    {
        if (active_ && callback_)
        {
            callback_();
        }
    }

    // 取消执行（例如资源已经手工释放）
    void dismiss()
    {
        active_ = false;
    }

private:
    std::function<void()> callback_;
    bool active_ = true;
};

inline ScopeGuard makeScopeGuard(std::function<void()> callback)
{
    return ScopeGuard(std::move(callback));
}

} // namespace liveutils
