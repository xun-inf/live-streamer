cmake_minimum_required(VERSION 3.25)

project(live-streamer VERSION 1.0.0 LANGUAGES CXX)

# Windows 资源编译（.rc -> PE 资源，media-service 的图标走这里）
if(WIN32)
  enable_language(RC)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

get_filename_component(LIVESTREAMER_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
# 第三方预编译库/头文件统一放 core/thirdparty（flatc、flatbuffers 头文件、rcedit 都由脚本自动下载，不入库）
set(LIVESTREAMER_THIRDPARTY_DIR ${CMAKE_CURRENT_SOURCE_DIR}/thirdparty)

# 只作用于本项目自己的 target，不影响 FetchContent 拉进来的第三方工程
add_library(livestreamer_options INTERFACE)
target_compile_definitions(livestreamer_options INTERFACE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
if (MSVC)
  target_compile_options(livestreamer_options INTERFACE /utf-8 /W4)
endif()

add_subdirectory(utils)
add_subdirectory(media-service)

# 统一输出目录：可执行文件都落到仓库根的 build/out/<Config>（多配置生成器自动追加配置名，
# 单配置生成器如 Ninja 则直接是 build/out）。静态库和中间产物留在各自的 build/core 子目录里。
get_filename_component(LIVESTREAMER_OUTPUT_DIR "${LIVESTREAMER_ROOT}/build/out" ABSOLUTE)

foreach(target liveStreamer mediaService)
  # liveStreamer（宿主）尚未创建，先跳过，等目标就位后自动生效
  if(TARGET ${target})
    set_target_properties(${target} PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY ${LIVESTREAMER_OUTPUT_DIR}
      PDB_OUTPUT_DIRECTORY ${LIVESTREAMER_OUTPUT_DIR})
  endif()
endforeach()
