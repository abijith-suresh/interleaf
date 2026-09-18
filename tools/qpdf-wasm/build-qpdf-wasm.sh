#!/usr/bin/env bash

set -euo pipefail

readonly QPDF_VERSION="12.4.1"
readonly QPDF_RELEASE_COMMIT="c37f83ae468abb6cc741f43b2f6fdeb66e550ffb"
readonly QPDF_ARCHIVE_SHA256="f045aa277be2356ff53a89a8622945958291177d2483afc20ede7c8a8cd3873c"
readonly EMSCRIPTEN_VERSION="3.1.72"

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
readonly WORK_DIR="${QPDF_WASM_BUILD_DIR:-${REPOSITORY_ROOT}/.qpdf-wasm-build}"
readonly OUTPUT_DIR="${1:-${WORK_DIR}/out}"
readonly QPDF_ARCHIVE="${WORK_DIR}/qpdf-${QPDF_VERSION}.tar.gz"
readonly QPDF_SOURCE_DIR="${WORK_DIR}/qpdf-${QPDF_VERSION}"
readonly QPDF_BUILD_DIR="${WORK_DIR}/qpdf-build"

die() {
  echo "qpdf WASM build: $*" >&2
  exit 1
}

command -v emcmake >/dev/null || die "emcmake is required (Emscripten ${EMSCRIPTEN_VERSION})"
command -v em++ >/dev/null || die "em++ is required (Emscripten ${EMSCRIPTEN_VERSION})"
command -v emcc >/dev/null || die "emcc is required (Emscripten ${EMSCRIPTEN_VERSION})"
command -v cmake >/dev/null || die "cmake is required"
command -v curl >/dev/null || die "curl is required"

emcc --version | grep -Fq "${EMSCRIPTEN_VERSION}" ||
  die "Emscripten ${EMSCRIPTEN_VERSION} is required"

sha256() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

if [[ ! -f "$QPDF_ARCHIVE" ]]; then
  curl --fail --location --retry 3 \
    "https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}.tar.gz" \
    --output "$QPDF_ARCHIVE"
fi

[[ "$(sha256 "$QPDF_ARCHIVE")" == "$QPDF_ARCHIVE_SHA256" ]] ||
  die "qpdf source archive checksum did not match the pinned release"

if [[ ! -f "$QPDF_SOURCE_DIR/CMakeLists.txt" ]]; then
  tar --extract --gzip --file "$QPDF_ARCHIVE" --directory "$WORK_DIR"
fi

readonly EMSCRIPTEN_SYSROOT="$(em-config CACHE)/sysroot"
readonly PORT_FLAGS="-fexceptions -sUSE_ZLIB=1 -sUSE_LIBJPEG=1"

emcmake cmake \
  -S "$QPDF_SOURCE_DIR" \
  -B "$QPDF_BUILD_DIR" \
  -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_STATIC_LIBS=ON \
  -DBUILD_DOC=OFF \
  -DBUILD_DOC_HTML=OFF \
  -DBUILD_DOC_PDF=OFF \
  -DINSTALL_MANUAL=OFF \
  -DINSTALL_EXAMPLES=OFF \
  -DUSE_IMPLICIT_CRYPTO=OFF \
  -DREQUIRE_CRYPTO_NATIVE=ON \
  -DZLIB_LIB_PATH="${EMSCRIPTEN_SYSROOT}/lib/wasm32-emscripten/libz.a" \
  -DZLIB_H_PATH="${EMSCRIPTEN_SYSROOT}/include" \
  -DLIBJPEG_LIB_PATH="${EMSCRIPTEN_SYSROOT}/lib/wasm32-emscripten/libjpeg.a" \
  -DLIBJPEG_H_PATH="${EMSCRIPTEN_SYSROOT}/include" \
  -DCMAKE_C_FLAGS="$PORT_FLAGS" \
  -DCMAKE_CXX_FLAGS="$PORT_FLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="$PORT_FLAGS" \
  -DCMAKE_SHARED_LINKER_FLAGS="$PORT_FLAGS"

cmake --build "$QPDF_BUILD_DIR" --target libqpdf --parallel

em++ \
  -std=c++20 \
  -fexceptions \
  -I"${QPDF_SOURCE_DIR}/include" \
  -I"${QPDF_SOURCE_DIR}/libqpdf" \
  -I"${QPDF_BUILD_DIR}/libqpdf" \
  "${SCRIPT_DIR}/qpdf-bridge.cc" \
  "${QPDF_BUILD_DIR}/libqpdf/libqpdf.a" \
  -sUSE_ZLIB=1 \
  -sUSE_LIBJPEG=1 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createQpdfModule \
  -sENVIRONMENT=web,worker \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_qpdf_optimize","_qpdf_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  --no-entry \
  -O3 \
  -o "${OUTPUT_DIR}/qpdf.mjs"

cp "${SCRIPT_DIR}/qpdf-worker.js" "${OUTPUT_DIR}/qpdf-worker.js"
cp "${SCRIPT_DIR}/smoke.html" "${OUTPUT_DIR}/smoke.html"

cat >"${OUTPUT_DIR}/build-info.txt" <<EOF
qpdf version: ${QPDF_VERSION}
qpdf release commit: ${QPDF_RELEASE_COMMIT}
qpdf source archive sha256: ${QPDF_ARCHIVE_SHA256}
emscripten version: ${EMSCRIPTEN_VERSION}
lossless profile: specialized non-lossy decode, Flate recompression level 9, version-safe object streams
image optimization: disabled
EOF

echo "qpdf WASM output written to ${OUTPUT_DIR}"
