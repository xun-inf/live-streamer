#include "ipcserver.h"
#include "./ipc/ipcserver_p.h"
#include <winuser.h>

// IpcServer implementation
IpcServer::IpcServer()
    : d_ptr(std::make_unique<IpcServerPrivate>()) {

}

IpcServer::~IpcServer() {

}

// 必须在 Start 之前设置
void IpcServer::SetMessageCallback(MessageCallback callback) {
    d_ptr->SetMessageCallback(callback);
}

// 必须在 Start 之前设置
void IpcServer::SetDisconnectCallback(DisconnectCallback callback) {
    d_ptr->SetDisconnectCallback(callback);
}

bool IpcServer::connected() const {
    return d_ptr->connected();
}

bool IpcServer::Start(const std::string& pipe_name) {
    return d_ptr->Start(pipe_name);
}

void IpcServer::Stop() {
    d_ptr->Stop();
}

bool IpcServer::Send(const std::vector<uint8_t>& msg) {
    return d_ptr->Send(msg);
}