include_guard(GLOBAL)

include(FetchContent)

set(LIVESTREAMER_SPDLOG_VERSION "1.17.0" CACHE STRING
  "spdlog version used by the native components")
set(LIVESTREAMER_SPDLOG_ROOT "" CACHE PATH
  "Optional local spdlog source root for offline builds")

set(_LIVESTREAMER_SPDLOG_SOURCE_SHA256
  "d8862955c6d74e5846b3f580b1605d2428b11d97a410d86e2fb13e857cd3a744")

function(livestreamer_add_spdlog)
  if(TARGET spdlog::spdlog)
    return()
  endif()

  set(SPDLOG_BUILD_SHARED OFF CACHE BOOL "" FORCE)
  set(SPDLOG_BUILD_EXAMPLE OFF CACHE BOOL "" FORCE)
  set(SPDLOG_BUILD_EXAMPLE_HO OFF CACHE BOOL "" FORCE)
  set(SPDLOG_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(SPDLOG_BUILD_TESTS_HO OFF CACHE BOOL "" FORCE)
  set(SPDLOG_BUILD_BENCH OFF CACHE BOOL "" FORCE)
  set(SPDLOG_INSTALL OFF CACHE BOOL "" FORCE)
  set(SPDLOG_SYSTEM_INCLUDES ON CACHE BOOL "" FORCE)
  set(SPDLOG_WCHAR_FILENAMES ON CACHE BOOL "" FORCE)

  if(LIVESTREAMER_SPDLOG_ROOT)
    get_filename_component(_spdlog_root
      "${LIVESTREAMER_SPDLOG_ROOT}" ABSOLUTE BASE_DIR "${LIVESTREAMER_ROOT}")
    if(NOT EXISTS "${_spdlog_root}/CMakeLists.txt")
      message(FATAL_ERROR
        "spdlog source not found: ${_spdlog_root}. "
        "LIVESTREAMER_SPDLOG_ROOT must point to a spdlog source tree.")
    endif()
    add_subdirectory("${_spdlog_root}"
      "${CMAKE_BINARY_DIR}/_deps/livestreamer_spdlog-build" EXCLUDE_FROM_ALL)
  else()
    FetchContent_Declare(livestreamer_spdlog
      URL
        "https://github.com/gabime/spdlog/archive/refs/tags/v${LIVESTREAMER_SPDLOG_VERSION}.tar.gz"
      URL_HASH "SHA256=${_LIVESTREAMER_SPDLOG_SOURCE_SHA256}"
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(livestreamer_spdlog)
  endif()

  if(NOT TARGET spdlog::spdlog)
    message(FATAL_ERROR "spdlog::spdlog target was not created")
  endif()
endfunction()
