#include "streampreview/gpudevice.h"

#include <d3d11_1.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <array>
#include <chrono>
#include <stdexcept>
#include <string>
#include <thread>

using Microsoft::WRL::ComPtr;

namespace
{

void check(HRESULT result, const char* operation)
{
    if (FAILED(result))
    {
        throw std::runtime_error(std::string(operation) + ": HRESULT=" + std::to_string(result));
    }
}

// 点采样 4:2:0 色度；输出 SDR BGRA，输入矩阵与量程由调用方明确指定。
const char kShader[] = R"(
Texture2D<float> yPlane : register(t0);
Texture2D<float2> uPlane : register(t1);
Texture2D<float> vPlane : register(t2);
cbuffer Parameters : register(b0) { float4 params; };
float4 vs(uint id : SV_VertexID) : SV_Position {
    float2 p = float2((id << 1) & 2, id & 2);
    return float4(p * float2(2, -2) + float2(-1, 1), 0, 1);
}
float4 ps(float4 position : SV_Position) : SV_Target {
    int2 p = int2(position.xy);
    float y = yPlane.Load(int3(p, 0));
    float2 uv = uPlane.Load(int3(p / 2, 0));
    float u = uv.x;
    float v = params.x > 0.5 ? uv.y : vPlane.Load(int3(p / 2, 0));
    y = params.y > 0.5 ? y : (y - 16.0 / 255.0) * (255.0 / 219.0);
    float scale = params.y > 0.5 ? 1.0 : 255.0 / 224.0;
    u = (u - 128.0 / 255.0) * scale;
    v = (v - 128.0 / 255.0) * scale;
    float3 rgb = params.z > 0.5
        ? float3(y + 1.5748*v, y - 0.187324*u - 0.468124*v, y + 1.8556*u)
        : float3(y + 1.402*v, y - 0.344136*u - 0.714136*v, y + 1.772*u);
    return float4(saturate(rgb), 1);
}
)";

struct TextureSlot
{
    ComPtr<ID3D11Texture2D> texture;
    ComPtr<ID3D11RenderTargetView> target;
    HANDLE handle = nullptr;
    uint64_t token = 0;
    uint32_t width = 0;
    uint32_t height = 0;

    ~TextureSlot()
    {
        if (handle)
        {
            ::CloseHandle(handle);
        }
    }
};

} // namespace

class GpuDevicePrivate
{
public:
    ComPtr<ID3D11Device> m_device;
    ComPtr<ID3D11DeviceContext> m_context;
    ComPtr<ID3D11VertexShader> m_vertexShader;
    ComPtr<ID3D11PixelShader> m_pixelShader;
    ComPtr<ID3D11Buffer> m_parameters;
    ComPtr<ID3D11Query> m_completion;
    std::array<std::shared_ptr<TextureSlot>, 3> m_slots;

    void initialize()
    {
        if (m_device)
        {
            return;
        }
        const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_0};
        check(::D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                                 levels, 1, D3D11_SDK_VERSION, &m_device, nullptr, &m_context), "D3D11CreateDevice");
        ComPtr<ID3DBlob> vs;
        ComPtr<ID3DBlob> ps;
        check(::D3DCompile(kShader, sizeof(kShader) - 1, nullptr, nullptr, nullptr, "vs", "vs_5_0", 0, 0, &vs, nullptr),
              "compile vertex shader");
        check(::D3DCompile(kShader, sizeof(kShader) - 1, nullptr, nullptr, nullptr, "ps", "ps_5_0", 0, 0, &ps, nullptr),
              "compile pixel shader");
        check(m_device->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &m_vertexShader),
              "CreateVertexShader");
        check(m_device->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, &m_pixelShader),
              "CreatePixelShader");
        D3D11_BUFFER_DESC buffer {};
        buffer.ByteWidth = 16;
        buffer.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
        check(m_device->CreateBuffer(&buffer, nullptr, &m_parameters), "CreateBuffer");
        D3D11_QUERY_DESC query {D3D11_QUERY_EVENT, 0};
        check(m_device->CreateQuery(&query, &m_completion), "CreateQuery");
    }

    void prepare(TextureSlot& slot, uint32_t width, uint32_t height)
    {
        if (slot.texture && slot.width == width && slot.height == height)
        {
            return;
        }
        if (slot.handle)
        {
            ::CloseHandle(slot.handle);
            slot.handle = nullptr;
        }
        slot.target.Reset();
        slot.texture.Reset();
        D3D11_TEXTURE2D_DESC desc {};
        desc.Width = width;
        desc.Height = height;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
        desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;
        check(m_device->CreateTexture2D(&desc, nullptr, &slot.texture), "CreateTexture2D(shared)");
        check(m_device->CreateRenderTargetView(slot.texture.Get(), nullptr, &slot.target), "CreateRenderTargetView");
        ComPtr<IDXGIResource1> resource;
        check(slot.texture.As(&resource), "IDXGIResource1");
        check(resource->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
                                           nullptr, &slot.handle), "CreateSharedHandle");
        slot.width = width;
        slot.height = height;
    }

    void convert(const VideoFrameView& frame, TextureSlot& slot)
    {
        if (frame.format == VideoPixelFormat::BGRA)
        {
            m_context->UpdateSubresource(slot.texture.Get(), 0, nullptr, frame.planes[0].data,
                                       static_cast<UINT>(frame.planes[0].stride), 0);
            return;
        }
        std::array<ComPtr<ID3D11Texture2D>, 3> planes;
        std::array<ComPtr<ID3D11ShaderResourceView>, 3> views;
        ID3D11ShaderResourceView* resources[3] {};
        const unsigned count = frame.format == VideoPixelFormat::I420 ? 3 : 2;
        for (unsigned i = 0; i < count; ++i)
        {
            D3D11_TEXTURE2D_DESC desc {};
            desc.Width = i == 0 ? frame.width : frame.width / 2;
            desc.Height = i == 0 ? frame.height : frame.height / 2;
            desc.MipLevels = 1;
            desc.ArraySize = 1;
            desc.Format = i == 1 && count == 2 ? DXGI_FORMAT_R8G8_UNORM : DXGI_FORMAT_R8_UNORM;
            desc.SampleDesc.Count = 1;
            desc.Usage = D3D11_USAGE_IMMUTABLE;
            desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
            D3D11_SUBRESOURCE_DATA data {frame.planes[i].data, static_cast<UINT>(frame.planes[i].stride), 0};
            check(m_device->CreateTexture2D(&desc, &data, &planes[i]), "CreateTexture2D(plane)");
            check(m_device->CreateShaderResourceView(planes[i].Get(), nullptr, &views[i]), "CreateShaderResourceView");
            resources[i] = views[i].Get();
        }
        const float values[] = {count == 2 ? 1.0f : 0.0f, frame.fullRange ? 1.0f : 0.0f,
                                frame.matrix == VideoColorMatrix::BT709 ? 1.0f : 0.0f, 0};
        m_context->UpdateSubresource(m_parameters.Get(), 0, nullptr, values, 0, 0);
        ID3D11Buffer* buffer = m_parameters.Get();
        m_context->PSSetConstantBuffers(0, 1, &buffer);
        m_context->PSSetShaderResources(0, 3, resources);
        m_context->VSSetShader(m_vertexShader.Get(), nullptr, 0);
        m_context->PSSetShader(m_pixelShader.Get(), nullptr, 0);
        m_context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        const D3D11_VIEWPORT viewport {0, 0, static_cast<float>(frame.width), static_cast<float>(frame.height), 0, 1};
        m_context->RSSetViewports(1, &viewport);
        ID3D11RenderTargetView* target = slot.target.Get();
        m_context->OMSetRenderTargets(1, &target, nullptr);
        m_context->Draw(3, 0);
        m_context->OMSetRenderTargets(0, nullptr, nullptr);
        ID3D11ShaderResourceView* empty[3] {};
        m_context->PSSetShaderResources(0, 3, empty);
    }
};

GpuDevice::GpuDevice() : d_ptr(std::make_unique<GpuDevicePrivate>())
{
}

GpuDevice::~GpuDevice() = default;

bool GpuDevice::present(const VideoFrameView& frame, uint64_t token, SharedVideoFrame& output)
{
    auto& d = *d_ptr;
    d.initialize();
    for (auto& resource : d.m_slots)
    {
        if (!resource)
        {
            resource = std::make_shared<TextureSlot>();
        }
        auto& slot = *resource;
        if (slot.token != 0)
        {
            continue;
        }
        d.prepare(slot, frame.width, frame.height);
        // Chromium 的 D3D shared image 使用 key 0；交接前释放同一个 key。
        ComPtr<IDXGIKeyedMutex> mutex;
        check(slot.texture.As(&mutex), "IDXGIKeyedMutex");
        if (mutex->AcquireSync(0, 1000) != S_OK)
        {
            throw std::runtime_error("shared texture mutex timeout");
        }
        try
        {
            d.convert(frame, slot);
            d.m_context->End(d.m_completion.Get());
            d.m_context->Flush();
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
            for (;;)
            {
                const HRESULT result = d.m_context->GetData(d.m_completion.Get(), nullptr, 0, 0);
                check(result, "GPU completion");
                if (result == S_OK)
                {
                    break;
                }
                if (std::chrono::steady_clock::now() >= deadline)
                {
                    throw std::runtime_error("GPU completion timeout");
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }
        catch (...)
        {
            mutex->ReleaseSync(0);
            throw;
        }
        check(mutex->ReleaseSync(0), "ReleaseSync");
        slot.token = token;
        output = {token, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(slot.handle)), frame.width, frame.height,
                  frame.timestampUs, resource};
        return true;
    }
    return false;
}

void GpuDevice::release(uint64_t token)
{
    for (auto& slot : d_ptr->m_slots)
    {
        if (slot && slot->token == token)
        {
            slot->token = 0;
            return;
        }
    }
}
