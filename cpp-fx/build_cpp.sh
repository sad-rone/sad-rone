#!/usr/bin/env bash
# build_cpp.sh — compiles effects.cpp to WASM with Emscripten.
#
# Requires the Emscripten SDK (emsdk) activated in your shell:
#   git clone https://github.com/emscripten-core/emsdk.git
#   ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh
#
# Run from this directory:
#   ./build_cpp.sh
#
# Output goes to ../pkg-cpp/ (effects.js + effects.wasm), same sibling-folder
# convention the Rust particle system uses for its wasm-pack output (../pkg/).
# image-fx-bridge.js and matrix-bridge.js both import from ../pkg-cpp/effects.js.

# NOTE: effects.cpp no longer includes <emscripten/emscripten.h> — the
# EMSCRIPTEN_KEEPALIVE macro is now defined locally in the .cpp using a
# plain __attribute__((visibility("default"))) guarded by the __EMSCRIPTEN__
# macro that emcc's driver predefines automatically. No header dependency
# is needed for that, so nothing below has to change to keep exporting the
# same symbol names.

set -euo pipefail
cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found on PATH." >&2
  echo "Install/activate the Emscripten SDK first:" >&2
  echo "  git clone https://github.com/emscripten-core/emsdk.git" >&2
  echo "  ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh" >&2
  exit 1
fi

OUT_DIR="../pkg-cpp"
mkdir -p "$OUT_DIR"

emcc effects.cpp \
  -O3 \
  -flto \
  -fno-exceptions \
  -fno-rtti \
  -fvisibility=hidden \
  -msimd128 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createEffectsModule \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMALLOC=emmalloc \
  -sENVIRONMENT=web \
  -sFILESYSTEM=0 \
  -sASSERTIONS=0 \
  -sTEXTDECODER=2 \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_fx_alloc,_fx_free,_glitch_rgba,_chroma_shift_rgba,_box_blur_rgba,_pixel_sort_rgba,_rain_init,_rain_step,_rain_free_buffers,_rain_brightness_ptr,_rain_glyph_ptr,_rain_cols,_rain_rows \
  --closure 1 \
  -o "$OUT_DIR/effects.js"

echo "Built $OUT_DIR/effects.js + $OUT_DIR/effects.wasm"
echo "  -msimd128:     4-wide SIMD for the per-pixel loops (glitch/blur/sort)"
echo "  emmalloc:      smaller + faster bump allocator, no threading overhead"
echo "  --closure 1:   minifies the JS glue (effects.js) for a lighter page load"
echo "  -sFILESYSTEM=0: drops unused Emscripten FS/node glue from the output"
