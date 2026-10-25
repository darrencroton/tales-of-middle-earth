cmake_minimum_required(VERSION 3.24)
project(tome2mobile C CXX)

if(NOT EMSCRIPTEN)
	message(FATAL_ERROR "tome2mobile must be configured with emcmake (Emscripten).")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
	set(CMAKE_BUILD_TYPE Release)
endif()

set(TOME2_DIR ${CMAKE_CURRENT_SOURCE_DIR}/external/tome2)
set(ENGINE_OUTPUT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/web/public/engine CACHE PATH "Directory receiving tome.js, tome.wasm and tome.data")

if(NOT EXISTS ${TOME2_DIR}/src/CMakeLists.txt)
	message(FATAL_ERROR "tome2 submodule missing; run: git submodule update --init")
endif()

#
# Compiler flags shared by every target, including fetched dependencies.
#
set(EMSCRIPTEN_COMMON_FLAGS "-fexceptions -sUSE_BOOST_HEADERS=1")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${EMSCRIPTEN_COMMON_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${EMSCRIPTEN_COMMON_FLAGS} -Wall -Wextra -Wno-unused-value -Wno-unused-parameter -DJSONCONS_NO_DEPRECATED")
set(CMAKE_C_FLAGS_RELEASE "-O2")
set(CMAKE_CXX_FLAGS_RELEASE "-O2")
set(CMAKE_C_FLAGS_DEBUG "-O0 -g")
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g")

#
# Dependencies (versions mirror external/tome2/CMakeLists.txt)
#
include(FetchContent)
set(FETCHCONTENT_QUIET ON)

FetchContent_Declare(fmt
	GIT_REPOSITORY https://github.com/fmtlib/fmt.git
	GIT_TAG 12.0.0
	GIT_SHALLOW TRUE)

set(JSONCONS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(jsoncons
	GIT_REPOSITORY https://github.com/danielaparker/jsoncons.git
	GIT_TAG v1.4.2
	GIT_SHALLOW TRUE)

FetchContent_Declare(pcg
	GIT_REPOSITORY https://github.com/imneme/pcg-cpp.git
	GIT_TAG 428802d1a5634f96bcd0705fab379ff0113bcf13
	SOURCE_SUBDIR no-cmake)

# Must match the Boost headers shipped by the Emscripten boost_headers port.
FetchContent_Declare(boost_filesystem
	GIT_REPOSITORY https://github.com/boostorg/filesystem.git
	GIT_TAG boost-1.83.0
	GIT_SHALLOW TRUE
	SOURCE_SUBDIR no-cmake)

FetchContent_MakeAvailable(fmt jsoncons pcg boost_filesystem)

add_library(boost_filesystem STATIC
	${boost_filesystem_SOURCE_DIR}/src/codecvt_error_category.cpp
	${boost_filesystem_SOURCE_DIR}/src/directory.cpp
	${boost_filesystem_SOURCE_DIR}/src/exception.cpp
	${boost_filesystem_SOURCE_DIR}/src/operations.cpp
	${boost_filesystem_SOURCE_DIR}/src/path.cpp
	${boost_filesystem_SOURCE_DIR}/src/path_traits.cpp
	${boost_filesystem_SOURCE_DIR}/src/portability.cpp
	${boost_filesystem_SOURCE_DIR}/src/unique_path.cpp
	${boost_filesystem_SOURCE_DIR}/src/utf8_codecvt_facet.cpp)
target_include_directories(boost_filesystem PRIVATE ${boost_filesystem_SOURCE_DIR}/src)
target_compile_definitions(boost_filesystem
	PUBLIC BOOST_FILESYSTEM_NO_DEPRECATED BOOST_FILESYSTEM_STATIC_LINK
	PRIVATE BOOST_FILESYSTEM_SOURCE
		BOOST_FILESYSTEM_SINGLE_THREADED
		BOOST_FILESYSTEM_DISABLE_STATX
		BOOST_FILESYSTEM_DISABLE_SENDFILE
		BOOST_FILESYSTEM_DISABLE_COPY_FILE_RANGE
		BOOST_FILESYSTEM_HAS_STAT_ST_MTIM)
target_compile_options(boost_filesystem PRIVATE -w)

#
# tome2 engine (libraries "game", "game_main" and "squelch" from the submodule)
#
set(LIBS fmt::fmt jsoncons boost_filesystem m)
include_directories(${pcg_SOURCE_DIR}/include)
add_compile_definitions(DEFAULT_PATH="/lib")

add_subdirectory(${TOME2_DIR}/src ${CMAKE_BINARY_DIR}/tome2 EXCLUDE_FROM_ALL)

#
# Web frontend
#
add_executable(tome engine/main-web.cc engine/snapshot.cc)
target_include_directories(tome PRIVATE ${TOME2_DIR}/src ${TOME2_DIR}/src/include)
target_link_libraries(tome PRIVATE game_main game squelch ${LIBS})

set_target_properties(tome PROPERTIES
	RUNTIME_OUTPUT_DIRECTORY ${ENGINE_OUTPUT_DIR}
	SUFFIX ".js")

set(TOME_LIB_DIR ${TOME2_DIR}/lib)
set(TOME_LINK_FLAGS
	-fexceptions
	-sUSE_BOOST_HEADERS=1
	-sASYNCIFY=1
	-sASYNCIFY_STACK_SIZE=262144
	-sSTACK_SIZE=4MB
	-sINITIAL_MEMORY=64MB
	-sALLOW_MEMORY_GROWTH=1
	-sMODULARIZE=1
	-sEXPORT_ES6=1
	-sEXPORT_NAME=createTomeModule
	-sENVIRONMENT=web
	-sEXIT_RUNTIME=1
	-sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAPU16,HEAP32,UTF8ToString
	-sEXPORTED_FUNCTIONS=_main,_web_snapshot,_web_features_json,_web_state_json
	-lidbfs.js
	-Wl,--wrap=nanosleep
	-Wl,--wrap=getpwuid
	"SHELL:--preload-file ${TOME_LIB_DIR}@/lib"
	"SHELL:--exclude-file ${TOME_LIB_DIR}/xtra/font"
	"SHELL:--exclude-file ${TOME_LIB_DIR}/xtra/music"
	"SHELL:--exclude-file ${TOME_LIB_DIR}/xtra/*.bdf"
	"SHELL:--exclude-file ${TOME_LIB_DIR}/xtra/*.fnt"
	"SHELL:--exclude-file ${TOME_LIB_DIR}/CMakeLists.txt"
	"SHELL:--exclude-file ${TOME_LIB_DIR}/mods/CMakeLists.txt")
target_link_options(tome PRIVATE ${TOME_LINK_FLAGS})
