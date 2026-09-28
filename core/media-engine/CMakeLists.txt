# media-engine：Electron 拉起的子进程，通过命名管道收命令并维护本地窗口
add_executable(mediaEngine
  src/application.cpp
  src/handlers/ipchandler.cpp
  src/handlers/ipcwindowhandler.cpp
  src/ipcserver.cpp
  src/main.cpp
  src/mewindow.cpp
  src/privates/application_p.cpp
  src/privates/ipcserver_p.cpp
  src/privates/mewindow_p.cpp
  # PE 资源：图标（config/app.ico）
  resources/app.rc)

set_target_properties(mediaEngine PROPERTIES OUTPUT_NAME "media-engine")

target_include_directories(mediaEngine PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  # 内部头文件（handlers/ 等）按 src 根包含：include 侧写 "handlers/xxx.h"
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  # flatc 生成的协议代码（scripts/schema.py -> core/common）
  ${CMAKE_CURRENT_SOURCE_DIR}/../common
  # flatbuffers C++ 头文件（scripts/schema.py 铺到 core/thirdparty）
  ${LIVESTREAMER_THIRDPARTY_DIR}/flatbuffers/include)

target_link_libraries(mediaEngine PRIVATE livestreamer_options liveUtils user32 gdi32 d3d11 dxgi)
