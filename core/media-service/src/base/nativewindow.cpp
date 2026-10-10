#include "nativewindow.h"
#include "nativewindow_p.h"

NativeWindow::NativeWindow() : d_ptr(std::make_unique<NativeWindowPrivate>())
{
}

NativeWindow::~NativeWindow() = default;

bool NativeWindow::attach(uint64_t parentHandle, bool show)
{
    return d_ptr->attach(parentHandle, show);
}

void NativeWindow::setRect(int32_t x, int32_t y, int32_t width, int32_t height)
{
    d_ptr->setRect(x, y, width, height);
}

void NativeWindow::detach()
{
    d_ptr->detach();
}

void NativeWindow::close()
{
    d_ptr->close();
}

uint64_t NativeWindow::nativeHandle() const
{
    return d_ptr->nativeHandle();
}
