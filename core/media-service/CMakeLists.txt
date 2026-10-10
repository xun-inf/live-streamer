# media-service：Electron 拉起的子进程，通过命名管道收命令并维护可视组件
add_executable(mediaService
  src/application.cpp
  src/base/config.cpp
  src/base/ipcserver.cpp
  src/base/eventloop.cpp
  src/base/logger.cpp
  src/base/nativewindow.cpp
  src/base/nativewindowmgr.cpp
  src/main.cpp
  src/ipchandlers/ipchandlers.cpp
  src/ipchandlers/nativewindowhandler.cpp
  src/ipchandlers/streampreviewhandler.cpp
  src/streampreview/framebuffer.cpp
  src/streampreview/streampreview.cpp
  src/streampreview/streampreviewmgr.cpp
  # PE 资源：图标（config/app.ico）
  resources/app.rc)

if(WIN32)
  # 收集各模块的 Windows 实现，文件增删时自动重新配置。
  file(GLOB_RECURSE media_service_win_sources CONFIGURE_DEPENDS
    RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")
  list(FILTER media_service_win_sources INCLUDE REGEX "/platform/win/")
  target_sources(mediaService PRIVATE ${media_service_win_sources})
endif()

set_target_properties(mediaService PROPERTIES OUTPUT_NAME "media-service")

target_include_directories(mediaService PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  # 跨目录引用内部头文件时按 src 根包含，如 "base/ipcserver_p.h" 或 "base/nativewindow_p.h"。
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  # flatc 生成的协议代码（scripts/schema.py -> core/common/ipcs）
  ${CMAKE_CURRENT_SOURCE_DIR}/../common)

target_link_libraries(mediaService PRIVATE
  livestreamer_options
  FlatBuffers::Headers
  liveUtils
  user32
  gdi32
  d3d11
  d3dcompiler
  dxgi)
