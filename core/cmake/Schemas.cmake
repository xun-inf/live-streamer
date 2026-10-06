include_guard(GLOBAL)

livestreamer_add_flatc()

set(_livestreamer_schema_dir "${LIVESTREAMER_ROOT}/schema")
set(_livestreamer_cpp_schema_dir "${LIVESTREAMER_ROOT}/core/common")
set(_livestreamer_ts_schema_dir "${LIVESTREAMER_ROOT}/electron/src/common")
set(_livestreamer_schemas
  "${_livestreamer_schema_dir}/main.fbs"
  "${_livestreamer_schema_dir}/ntwindow.fbs")

add_custom_target(generate-schemas
  COMMAND "${CMAKE_COMMAND}" -E make_directory
    "${_livestreamer_cpp_schema_dir}"
    "${_livestreamer_ts_schema_dir}"
  COMMAND FlatBuffers::flatc --cpp -o "${_livestreamer_cpp_schema_dir}"
    ${_livestreamer_schemas}
  COMMAND FlatBuffers::flatc --ts -o "${_livestreamer_ts_schema_dir}"
    ${_livestreamer_schemas}
  DEPENDS ${_livestreamer_schemas}
  WORKING_DIRECTORY "${LIVESTREAMER_ROOT}"
  COMMENT "Generating FlatBuffers C++ and TypeScript sources"
  VERBATIM)
