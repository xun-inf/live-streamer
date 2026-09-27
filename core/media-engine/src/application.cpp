#include "application.h"

MeApplication* MeApplication::s_instance = nullptr;

MeApplication::MeApplication(int argc, char** argv)
    : d_ptr(std::make_unique<MeApplicationPrivate>())