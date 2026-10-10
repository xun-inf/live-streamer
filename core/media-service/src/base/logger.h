#pragma once

#include "utils/logger.h"

namespace mediaservice
{

// 服务进程共享的日志实例；首次调用时线程安全初始化。
liveutils::Logger& logger();

} // namespace mediaservice
