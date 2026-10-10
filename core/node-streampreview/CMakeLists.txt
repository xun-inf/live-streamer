# 只使用稳定 Node-API 头文件；运行时从宿主取符号，兼容改名的 Electron exe。
file(GLOB _node_api_candidates "$ENV{LOCALAPPDATA}/node-gyp/Cache/*/include/node")
find_path(LIVESTREAMER_NODE_API_INCLUDE node_api.h HINTS ${_node_api_candidates}
  DOC "Directory containing Node-API headers (node_api.h)")
if(NOT LIVESTREAMER_NODE_API_INCLUDE)
  message(FATAL_ERROR "Set LIVESTREAMER_NODE_API_INCLUDE to the Node.js include/node directory")
endif()

add_library(nodeStreamPreview MODULE src/texturehandle.cpp)
target_include_directories(nodeStreamPreview PRIVATE "${LIVESTREAMER_NODE_API_INCLUDE}")
target_link_libraries(nodeStreamPreview PRIVATE livestreamer_options)
set_target_properties(nodeStreamPreview PROPERTIES PREFIX "" SUFFIX ".node"
  OUTPUT_NAME "node-streampreview"
  LIBRARY_OUTPUT_DIRECTORY "${LIVESTREAMER_ROOT}/build/bin"
  RUNTIME_OUTPUT_DIRECTORY "${LIVESTREAMER_ROOT}/build/bin")
