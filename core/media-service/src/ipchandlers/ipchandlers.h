#pragma once

class IpcServer;

// 初始化阶段统一注册内置 handler；每个 IpcServer 调用一次。
bool registerIpcHandlers(IpcServer& server);
