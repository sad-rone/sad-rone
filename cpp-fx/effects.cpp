// effects.cpp — heavy per-pixel image effects + matrix-rain simulation,
// compiled to WASM via Emscripten.
//
// Two independent subsystems share this one module so the site only pays
// for a single wasm fetch/instantiate:
//
//   1. Image FX   — glitch / chroma-shift / block-displace / box-blur /
//                    pixel-sort, operating directly on a raw RGBA buffer
//                    in wasm linear memory. Used for the avatar hover-glitch
//                    and for periodic glitch flicker on sampled background
//                    <video> frames. These are "big" per-pixel jobs
//                    (hundreds of thousands of pixels x 4 channels, ideally
//                    every frame) that a JS `for` loop over a
//                    Uint8ClampedArray chokes on well before a plain 1080p
//                    canvas keeps up at 60fps — exactly the case a compiled,
//                    no-bounds-check, SIMD-friendly loop is for.
//
//   2. Matrix rain — simulation only. No drawing happens here — Canvas2D
//                    text rendering stays in JS (same split scripts.js /
//                    lib.rs already use for the particle system: Rust/C++
//                    owns the numeric hot loop, JS owns actually painting
//                    pixels via the browser's own font rasterizer, which
//                    wasm has no cheap access to). This tracks a few hundred
//                    falling "drop" columns — position, speed, trail length,
//                    per-cell glyph churn — and writes a brightness+glyph
//                    grid into linear memory that JS reads once per rAF
//                    frame and paints with fillText.
//
// Build: see build_cpp.sh (emcc -O3, MODULARIZE + ES6 output -> pkg-cpp/).
// JS side: image-fx-bridge.js (image effects) and matrix-bridge.js (rain).
//
// Memory convention for both subsystems: JS never touches wasm memory
// directly except through HEAPU8, using pointers these functions hand back.
// Nothing here throws / uses exceptions (-fno-exceptions in the build),
// keeping the module small and avoiding the exception-handling JS glue.

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cmath>

// ---------------------------------------------------------------------
// Export macro — deliberately NOT pulling in <emscripten/emscripten.h>.
// That header drags in extra glue (em_asm/async helpers, val bindings,
// etc.) this module never uses; all it actually gives us is the
// `EMSCRIPTEN_KEEPALIVE` attribute, which is just a visibility
// attribute under the hood. Defining it ourselves keeps the translation
// unit dependency-free (it now compiles cleanly with plain clang/gcc for
// native/unit testing too) while still emitting the exact same exported
// symbols when built for wasm with emcc (__EMSCRIPTEN__ is predefined
// by emcc's driver, no header needed for that either).
// ---------------------------------------------------------------------
#if defined(__EMSCRIPTEN__)
#define EMSCRIPTEN_KEEPALIVE __attribute__((used, visibility("default")))
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

extern "C" {

// ---------------------------------------------------------------------
// Tiny xorshift32 PRNG — same rationale as the Rust particle system's:
// avoid crossing back into JS Math.random() in a hot loop, avoid pulling
// in a real RNG crate/lib for something this simple. Not cryptographic.
// ---------------------------------------------------------------------
static inline uint32_t xorshift32(uint32_t& s) {
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return s;
}
static inline float rand01(uint32_t& s) {
  return static_cast<float>(xorshift32(s) >> 8) * (1.0f / 16777216.0f); // 24-bit mantissa -> [0,1)
}
static inline uint32_t seed_or_default(uint32_t seed) {
  return seed == 0 ? 0x9E3779B9u : seed;
}

// =======================================================================
// 1. IMAGE FX — operates in place on an RGBA8 buffer (row-major, 4 bytes
//    per pixel). JS allocates the buffer with fx_alloc(), fills it from a
//    canvas ImageData via HEAPU8.set(), calls one of these, then reads the
//    (now-mutated) bytes back out with HEAPU8.subarray().
// =======================================================================

EMSCRIPTEN_KEEPALIVE
uint8_t* fx_alloc(int bytes) {
  return static_cast<uint8_t*>(std::malloc(static_cast<size_t>(bytes)));
}

EMSCRIPTEN_KEEPALIVE
void fx_free(uint8_t* p) {
  std::free(p);
}

static inline int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

// RGB channel shift ("chromatic aberration" glitch look): red channel
// sampled `shift_px` to the left, blue channel `shift_px` to the right,
// green untouched. Requires a scratch copy since reads/writes alias.
EMSCRIPTEN_KEEPALIVE
void chroma_shift_rgba(uint8_t* data, int w, int h, int shift_px) {
  if (shift_px == 0) return;
  const size_t n = static_cast<size_t>(w) * static_cast<size_t>(h) * 4;
  uint8_t* src = static_cast<uint8_t*>(std::malloc(n));
  if (!src) return;
  std::memcpy(src, data, n);

  for (int y = 0; y < h; y++) {
    const size_t row = static_cast<size_t>(y) * static_cast<size_t>(w) * 4;
    for (int x = 0; x < w; x++) {
      const int xr = clampi(x - shift_px, 0, w - 1);
      const int xb = clampi(x + shift_px, 0, w - 1);
      data[row + static_cast<size_t>(x) * 4 + 0] = src[row + static_cast<size_t>(xr) * 4 + 0]; // R from the left
      data[row + static_cast<size_t>(x) * 4 + 2] = src[row + static_cast<size_t>(xb) * 4 + 2]; // B from the right
      // G (index 1) and A (index 3) stay as-is.
    }
  }
  std::free(src);
}

// Full glitch pass: a handful of random horizontal "slice" bands get
// displaced sideways (classic VHS-tear look), plus scanline darkening,
// plus a chroma shift whose strength scales with `intensity`. Everything
// is derived from `seed` so a caller can get a different glitch each call
// by bumping the seed (e.g. from performance.now()).
EMSCRIPTEN_KEEPALIVE
void glitch_rgba(uint8_t* data, int w, int h, float intensity, uint32_t seed) {
  if (w <= 0 || h <= 0) return;
  uint32_t s = seed_or_default(seed);
  intensity = intensity < 0.f ? 0.f : (intensity > 1.f ? 1.f : intensity);

  const size_t row_bytes = static_cast<size_t>(w) * 4;
  uint8_t* row_buf = static_cast<uint8_t*>(std::malloc(row_bytes));
  if (!row_buf) return;

  // Slice displacement: 3-10 bands depending on intensity, each a random
  // run of rows shifted left/right by up to ~8% of the width.
  const int bands = 3 + static_cast<int>(rand01(s) * 8 * intensity);
  const int max_shift = static_cast<int>(static_cast<float>(w) * 0.08f * intensity) + 1;
  for (int b = 0; b < bands; b++) {
    int y0 = static_cast<int>(rand01(s) * static_cast<float>(h));
    int band_h = 1 + static_cast<int>(rand01(s) * (static_cast<float>(h) * 0.03f + 2));
    int y1 = clampi(y0 + band_h, 0, h);
    int shift = static_cast<int>((rand01(s) - 0.5f) * 2.f * static_cast<float>(max_shift));
    if (shift == 0) continue;
    for (int y = y0; y < y1; y++) {
      uint8_t* r = data + static_cast<size_t>(y) * row_bytes;
      std::memcpy(row_buf, r, row_bytes);
      for (int x = 0; x < w; x++) {
        int sx = clampi(x - shift, 0, w - 1);
        std::memcpy(r + x * 4, row_buf + sx * 4, 4);
      }
    }
  }
  std::free(row_buf);

  // Scanline darkening: every other line loses a little brightness —
  // cheap, no allocation, just a multiply per byte.
  const uint8_t dark = static_cast<uint8_t>(40 * intensity);
  if (dark > 0) {
    for (int y = 0; y < h; y += 2) {
      uint8_t* r = data + static_cast<size_t>(y) * row_bytes;
      for (int x = 0; x < w; x++) {
        for (int c = 0; c < 3; c++) {
          int v = r[x * 4 + c] - dark;
          r[x * 4 + c] = static_cast<uint8_t>(v < 0 ? 0 : v);
        }
      }
    }
  }

  chroma_shift_rgba(data, w, h, 1 + static_cast<int>(6 * intensity));
}

// Separable box blur (horizontal pass then vertical pass) — cheap
// approximation of Gaussian blur, good enough for a background glitch
// flicker and much simpler/faster than a real Gaussian kernel.
EMSCRIPTEN_KEEPALIVE
void box_blur_rgba(uint8_t* data, int w, int h, int radius) {
  if (radius <= 0 || w <= 0 || h <= 0) return;
  const size_t n = static_cast<size_t>(w) * static_cast<size_t>(h) * 4;
  uint8_t* tmp = static_cast<uint8_t*>(std::malloc(n));
  if (!tmp) return;

  // Horizontal pass: data -> tmp
  for (int y = 0; y < h; y++) {
    const size_t row = static_cast<size_t>(y) * static_cast<size_t>(w) * 4;
    for (int x = 0; x < w; x++) {
      int sum[4] = {0, 0, 0, 0};
      int count = 0;
      for (int k = -radius; k <= radius; k++) {
        int xx = clampi(x + k, 0, w - 1);
        const uint8_t* px = data + row + xx * 4;
        sum[0] += px[0]; sum[1] += px[1]; sum[2] += px[2]; sum[3] += px[3];
        count++;
      }
      uint8_t* out = tmp + row + x * 4;
      out[0] = static_cast<uint8_t>(sum[0] / count);
      out[1] = static_cast<uint8_t>(sum[1] / count);
      out[2] = static_cast<uint8_t>(sum[2] / count);
      out[3] = static_cast<uint8_t>(sum[3] / count);
    }
  }
  // Vertical pass: tmp -> data
  for (int x = 0; x < w; x++) {
    for (int y = 0; y < h; y++) {
      int sum[4] = {0, 0, 0, 0};
      int count = 0;
      for (int k = -radius; k <= radius; k++) {
        int yy = clampi(y + k, 0, h - 1);
        const uint8_t* px = tmp + (static_cast<size_t>(yy) * static_cast<size_t>(w) + static_cast<size_t>(x)) * 4;
        sum[0] += px[0]; sum[1] += px[1]; sum[2] += px[2]; sum[3] += px[3];
        count++;
      }
      uint8_t* out = data + (static_cast<size_t>(y) * static_cast<size_t>(w) + static_cast<size_t>(x)) * 4;
      out[0] = static_cast<uint8_t>(sum[0] / count);
      out[1] = static_cast<uint8_t>(sum[1] / count);
      out[2] = static_cast<uint8_t>(sum[2] / count);
      out[3] = static_cast<uint8_t>(sum[3] / count);
    }
  }
  std::free(tmp);
}

static inline int luminance(const uint8_t* px) {
  // Fast integer luma approximation (Rec. 601-ish weights, no floats).
  return (px[0] * 77 + px[1] * 150 + px[2] * 29) >> 8;
}

// Pixel-sort glitch: within each row (or column, if `vertical`), find runs
// of pixels whose luminance exceeds `threshold` and sort just that run by
// luminance. Produces the classic "melting/streaking" pixel-sort look.
// O(w*h*log(run)) worst case — the kind of thing that's fine in a compiled
// loop but noticeably janky as a per-frame JS effect on a full-size canvas.
EMSCRIPTEN_KEEPALIVE
void pixel_sort_rgba(uint8_t* data, int w, int h, uint8_t threshold, int vertical) {
  if (w <= 0 || h <= 0) return;
  const int lines = vertical ? w : h;
  const int len   = vertical ? h : w;
  const size_t stride = vertical ? static_cast<size_t>(w) * 4 : 4; // byte step between consecutive pixels in the run
  uint8_t* run_buf = static_cast<uint8_t*>(std::malloc(static_cast<size_t>(len) * 4));
  if (!run_buf) return;

  for (int line = 0; line < lines; line++) {
    uint8_t* base = vertical
      ? data + static_cast<size_t>(line) * 4
      : data + static_cast<size_t>(line) * static_cast<size_t>(w) * 4;

    int i = 0;
    while (i < len) {
      uint8_t* p0 = base + static_cast<size_t>(i) * stride;
      if (luminance(p0) <= threshold) { i++; continue; }
      int j = i;
      while (j < len) {
        uint8_t* pj = base + static_cast<size_t>(j) * stride;
        if (luminance(pj) <= threshold) break;
        j++;
      }
      int run_len = j - i;
      if (run_len > 1) {
        // Copy run into a contiguous scratch buffer, insertion-sort by
        // luminance (runs are short — a handful to a few dozen pixels —
        // so O(n^2) insertion sort beats std::sort's overhead here).
        for (int k = 0; k < run_len; k++) {
          std::memcpy(run_buf + k * 4, base + static_cast<size_t>(i + k) * stride, 4);
        }
        for (int a = 1; a < run_len; a++) {
          uint8_t key[4];
          std::memcpy(key, run_buf + a * 4, 4);
          int key_lum = luminance(key);
          int b = a - 1;
          while (b >= 0 && luminance(run_buf + b * 4) > key_lum) {
            std::memcpy(run_buf + (b + 1) * 4, run_buf + b * 4, 4);
            b--;
          }
          std::memcpy(run_buf + (b + 1) * 4, key, 4);
        }
        for (int k = 0; k < run_len; k++) {
          std::memcpy(base + static_cast<size_t>(i + k) * stride, run_buf + k * 4, 4);
        }
      }
      i = j + 1;
    }
  }
  std::free(run_buf);
}

// =======================================================================
// 2. MATRIX RAIN — simulation state for N falling columns. No canvas
//    access here at all (Emscripten can bind to Canvas2D like Rust's
//    web-sys does, but text rendering specifically wants the browser's
//    font shaping/rasterizer — there's no win to doing that from wasm).
//    JS calls rain_init once, rain_resize on layout changes, rain_step
//    every rAF tick, then reads the brightness/glyph grids and paints
//    with fillText. All state lives in module-global buffers so JS only
//    ever needs two pointers.
// =======================================================================

struct RainCol {
  float y;           // head row position (fractional, for smooth sub-row speed)
  float speed;       // rows per second
  int   length;      // trail length in rows
  int   churnEvery;  // re-randomize a glyph roughly every N steps (flicker rate)
  uint32_t rng;
};

static RainCol* g_cols = nullptr;
static int g_cols_n = 0;
static int g_rows = 0;
static uint8_t* g_brightness = nullptr; // cols * rows, 0..255
static uint8_t* g_glyph      = nullptr; // cols * rows, index into JS-side charset
static uint32_t g_rng = 0x9E3779B9u;

static void respawn_col(RainCol& c, int rows) {
  c.y = -(rand01(c.rng) * static_cast<float>(rows) * 0.5f); // stagger start above the top edge
  c.speed = 4.0f + rand01(c.rng) * 14.0f;           // rows/sec
  c.length = 6 + static_cast<int>(rand01(c.rng) * static_cast<float>(rows > 30 ? 24 : rows / 2));
  c.churnEvery = 2 + static_cast<int>(rand01(c.rng) * 6);
}

EMSCRIPTEN_KEEPALIVE
void rain_free_buffers() {
  std::free(g_cols); g_cols = nullptr;
  std::free(g_brightness); g_brightness = nullptr;
  std::free(g_glyph); g_glyph = nullptr;
  g_cols_n = 0; g_rows = 0;
}

// (Re)allocate for a `cols` x `rows` grid and (re)seed every column. Call
// on first mount and again whenever the canvas is resized to a
// meaningfully different column/row count (debounced on the JS side).
EMSCRIPTEN_KEEPALIVE
void rain_init(int cols, int rows, uint32_t seed) {
  rain_free_buffers();
  if (cols <= 0 || rows <= 0) return;
  g_rng = seed_or_default(seed);
  g_cols_n = cols;
  g_rows = rows;
  g_cols = static_cast<RainCol*>(std::malloc(sizeof(RainCol) * static_cast<size_t>(cols)));
  g_brightness = static_cast<uint8_t*>(std::calloc(static_cast<size_t>(cols) * static_cast<size_t>(rows), 1));
  g_glyph      = static_cast<uint8_t*>(std::calloc(static_cast<size_t>(cols) * static_cast<size_t>(rows), 1));
  if (!g_cols || !g_brightness || !g_glyph) { rain_free_buffers(); return; }

  for (int c = 0; c < cols; c++) {
    g_cols[c].rng = xorshift32(g_rng) ^ (static_cast<uint32_t>(c) * 2654435761u);
    respawn_col(g_cols[c], rows);
    // Desync initial head positions so columns don't all fall in lockstep.
    g_cols[c].y = rand01(g_cols[c].rng) * static_cast<float>(rows);
  }
}

// Advance the simulation by `dt` seconds and refill the brightness/glyph
// grids. Grid layout is row-major: index = row * cols + col, matching a
// typical 2D fillText loop (for row { for col { ... } }) on the JS side.
EMSCRIPTEN_KEEPALIVE
void rain_step(float dt) {
  if (!g_cols || g_cols_n <= 0 || g_rows <= 0) return;
  if (dt < 0.f || dt > 0.25f) dt = 1.f / 60.f; // clamp huge gaps (bg tab, devtools pause)

  std::memset(g_brightness, 0, static_cast<size_t>(g_cols_n) * static_cast<size_t>(g_rows));

  for (int c = 0; c < g_cols_n; c++) {
    RainCol& col = g_cols[c];
    col.y += col.speed * dt;
    if (col.y - static_cast<float>(col.length) > static_cast<float>(g_rows)) {
      respawn_col(col, g_rows);
    }

    const int head = static_cast<int>(col.y);
    for (int k = 0; k < col.length; k++) {
      int row = head - k;
      if (row < 0 || row >= g_rows) continue;
      // Bright head, exponential fade down the tail.
      float t = static_cast<float>(k) / static_cast<float>(col.length);
      int b = static_cast<int>(255.0f * (k == 0 ? 1.0f : std::pow(1.0f - t, 1.6f)));
      g_brightness[static_cast<size_t>(row) * static_cast<size_t>(g_cols_n) + static_cast<size_t>(c)] = static_cast<uint8_t>(b < 0 ? 0 : (b > 255 ? 255 : b));

      // Occasionally re-roll the glyph shown at this cell — this is what
      // gives matrix rain its flicker, independent of the fall speed.
      size_t idx = static_cast<size_t>(row) * static_cast<size_t>(g_cols_n) + static_cast<size_t>(c);
      if ((xorshift32(col.rng) % static_cast<uint32_t>(col.churnEvery)) == 0) {
        g_glyph[idx] = static_cast<uint8_t>(xorshift32(col.rng) & 0x7F);
      }
    }
  }
}

EMSCRIPTEN_KEEPALIVE
uint8_t* rain_brightness_ptr() { return g_brightness; }

EMSCRIPTEN_KEEPALIVE
uint8_t* rain_glyph_ptr() { return g_glyph; }

EMSCRIPTEN_KEEPALIVE
int rain_cols() { return g_cols_n; }

EMSCRIPTEN_KEEPALIVE
int rain_rows() { return g_rows; }

} // extern "C"
