# media-service：Electron 拉起的子进程，通过命名管道收命令并维护本地窗口
add_executable(mediaService
  src/application.cpp
  src/application_p.cpp
  src/config.cpp
  src/ipc/ipcserver.cpp
  src/ipc/ipcserver_p.cpp
  src/main.cpp
  src/view/ipcviewhandler.cpp
  src/view/ntwindow.cpp
  src/view/ntwindow_p.cpp
  src/view/ntwindowmgr.cpp
  src/view/ntwindowmgr_p.cpp
  # PE 资源：图标（config/app.ico）
  resources/app.rc)

set_target_properties(mediaService PROPERTIES OUTPUT_NAME "media-service")

target_include_directories(mediaService PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  # 内部头文件（ipc/、view/ 等）按 src 根包含：include 侧写 "ipc/xxx.h"
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  # flatc 生成的协议代码（scripts/schema.py -> core/common）
  ${CMAKE_CURRENT_SOURCE_DIR}/../common)

target_link_libraries(mediaService PRIVATE
  livestreamer_options
  FlatBuffers::Headers
  liveUtils
  user32
  gdi32
  d3d11
  dxgi)
