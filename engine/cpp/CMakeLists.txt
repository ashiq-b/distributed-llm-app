# Builds the pinned llama.cpp (static, RPC on) plus our thin C wrapper `dl_engine`.
# Driven by engine/build.rs via the `cmake` crate; only the dl_engine target and
# its dependencies are built.
cmake_minimum_required(VERSION 3.16)
project(dl_engine C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(BUILD_SHARED_LIBS     OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL            OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS     OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS     OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES  OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP       OFF CACHE BOOL "" FORCE)
set(GGML_RPC              ON  CACHE BOOL "" FORCE)
# RDMA (Thunderbolt/InfiniBand) is not available on iOS/Android and we only use Wi‑Fi TCP.
set(GGML_RPC_RDMA         OFF CACHE BOOL "" FORCE)
if(APPLE)
    set(GGML_METAL                ON CACHE BOOL "" FORCE)
    set(GGML_METAL_EMBED_LIBRARY  ON CACHE BOOL "" FORCE)
endif()

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../llama.cpp llama.cpp)

add_library(dl_engine STATIC dl_engine.cpp dl_stats.cpp)
target_include_directories(dl_engine PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(dl_engine PRIVATE llama ggml ggml-rpc)
