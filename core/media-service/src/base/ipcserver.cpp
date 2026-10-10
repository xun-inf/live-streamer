#include "ipcserver.h"
#include "ipcserver_p.h"

#include "logger.h"

#include <cstddef>
#include <exception>
#include <utility>

// IpcServer implementation
IpcServer::IpcServer(DisconnectCallback callback)
    : d_ptr(std::make_unique<IpcServerPrivate>(std::move(callback)))
{
}

IpcServer::~IpcServer()
{
}

bool IpcServer::registerHandler(std::shared_ptr<IpcHandler> handler)
{
    return d_ptr->registerHandler(handler);
}

bool IpcServer::connected() const
{
    return d_ptr->connected();
}

bool IpcServer::start(const std::string& pipeName)
{
    return d_ptr->start(pipeName);
}

void IpcServer::stop()
{
    d_ptr->stop();
}

bool IpcServer::send(const std::vector<uint8_t>& msg)
{
    return d_ptr->send(msg);
}

namespace
{

constexpr std::size_t kMaxMessageSize = 8 * 1024 * 1024;

bool isBusinessDomain(Domain domain)
{
    const char* name = EnumNameDomain(domain);
    return domain != Domain_None && name != nullptr && name[0] != '\0';
}

void logWarning(const char* message) noexcept
{
    try
    {
        mediaservice::logger().logWarn("ipc", message);
    }
    catch (...)
    {
        // 日志失败也不能让异常越过 IPC 线程边界。
    }
}

} // namespace

IpcServerPrivate::IpcServerPrivate(DisconnectCallback callback)
    : m_disconnectCallback(std::move(callback))
{
}

bool IpcServerPrivate::registerHandler(std::shared_ptr<IpcHandler> handler)
{
    if (!handler)
    {
        return false;
    }
    try
    {
        const Domain domain = handler->domain();
        if (!isBusinessDomain(domain))
        {
            return false;
        }
        std::lock_guard<std::mutex> lock(m_handlerMutex);
        return m_handlers.emplace(domain, std::move(handler)).second;
    }
    catch (...)
    {
        logWarning("handler registration failed");
        return false;
    }
}

bool IpcServerPrivate::connected() const
{
    return m_connected.load();
}

bool IpcServerPrivate::dispatch(const std::vector<uint8_t>& message) const noexcept
{
    try
    {
        if (message.empty() || message.size() > kMaxMessageSize)
        {
            logWarning("invalid message size");
            return false;
        }
        flatbuffers::Verifier verifier(message.data(), message.size());
        if (!VerifyEnvelopeBuffer(verifier))
        {
            logWarning("invalid FlatBuffer message");
            return false;
        }

        const Envelope* envelope = GetEnvelope(message.data());
        if (!isBusinessDomain(envelope->domain()))
        {
            logWarning("unknown business domain");
            return false;
        }

        std::shared_ptr<IpcHandler> handler;
        {
            std::lock_guard<std::mutex> lock(m_handlerMutex);
            const auto it = m_handlers.find(envelope->domain());
            if (it != m_handlers.end())
            {
                handler = it->second;
            }
        }
        if (!handler)
        {
            logWarning("no handler registered for business domain");
            return false;
        }

        return handler->onIpcMessage(*envelope);
    }
    catch (const std::exception& error)
    {
        logWarning(error.what());
        return false;
    }
    catch (...)
    {
        logWarning("message handler threw an unknown exception");
        return false;
    }
}
