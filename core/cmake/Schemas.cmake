include_guard(GLOBAL)

livestreamer_add_flatc()

set(_livestreamer_schema_dir "${LIVESTREAMER_ROOT}/schema")
set(_livestreamer_cpp_schema_dir "${LIVESTREAMER_ROOT}/core/common/ipcs")
set(_livestreamer_ts_schema_dir "${LIVESTREAMER_ROOT}/electron/src/common/ipcs")
set(_livestreamer_schemas
  "${_livestreamer_schema_dir}/ipc_protocol.fbs"
  "${_livestreamer_schema_dir}/ipc_nativewindow.fbs"
  "${_livestreamer_schema_dir}/ipc_streampreview.fbs")

add_custom_target(generate-schemas
  COMMAND "${CMAKE_COMMAND}" -E make_directory
    "${_livestreamer_cpp_schema_dir}"
    "${_livestreamer_ts_schema_dir}"
  # C++ 协议头统一为 ipc_<名称>.h，关闭默认的 _generated 后缀。
  COMMAND FlatBuffers::flatc --cpp --filename-suffix ""
    -o "${_livestreamer_cpp_schema_dir}"
    ${_livestreamer_schemas}
  COMMAND FlatBuffers::flatc --ts -o "${_livestreamer_ts_schema_dir}"
    ${_livestreamer_schemas}
  DEPENDS ${_livestreamer_schemas}
  WORKING_DIRECTORY "${LIVESTREAMER_ROOT}"
  COMMENT "Generating FlatBuffers C++ and TypeScript sources"
  VERBATIM)
