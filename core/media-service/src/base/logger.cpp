#include "logger.h"

namespace mediaservice
{

liveutils::Logger& logger()
{
    static liveutils::Logger instance;
    return instance;
}

} // namespace mediaservice
