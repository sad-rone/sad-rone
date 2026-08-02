// matrix-bridge.js — boots the C++/WASM matrix-rain simulation and paints
// it onto a full-viewport canvas behind the site content.
//
// Requires the emcc build output at ./pkg-cpp/ next to this file (same
// module image-fx-bridge.js uses):
//   cd cpp-fx && ./build_cpp.sh
//
// Add `<canvas id="matrixCanvas"></canvas>` to index.html (placed like
// #pCanvas — behind content, above the background video/scrim) and
// `<script type="module" src="matrix-bridge.js"></script>`, loaded after
// perf.js.
//
// Split of responsibilities, mirroring particle-bridge.js: wasm owns the
// numeric simulation (column position/speed/trail/glyph-churn state for
// however many columns fit the viewport — can be hundreds on a wide
// screen), JS owns painting, because canvas text rendering needs the
// browser's own font shaping/rasterizer, which isn't something wasm has
// cheap access to. Every rAF tick this just reads two flat byte arrays
// (brightness + glyph index per cell) out of wasm memory and does one
// fillText per non-empty cell.

import createEffectsModule from './pkg-cpp/effects.js';

(async () => {
  const canvas = document.getElementById('matrixCanvas');
  if (!canvas) return;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) { canvas.style.display = 'none'; return; }

  const perfMgr = window.PerfManager;
  const quality = perfMgr ? perfMgr.quality : 'medium';
  if (quality === 'minimal') { canvas.style.display = 'none'; return; }

  let Module;
  try {
    Module = await createEffectsModule();
  } catch (err) {
    console.warn('matrix-bridge: wasm module failed to load, skipping matrix rain', err);
    canvas.style.display = 'none';
    return;
  }

  const ctx = canvas.getContext('2d');

  // Charset for the falling glyphs — kept ASCII + a few JP-ish looking
  // symbols the classic effect uses, indexed 0-127 to match the uint8
  // glyph buffer's `& 0x7F` mask in rain_step().
  const CHARSET = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>/\\|=+*:.-_';
  const glyphFor = (idx) => CHARSET[idx % CHARSET.length];

  const CELL = quality === 'high' ? 16 : 20; // px per grid cell — fewer/larger cells on lower tiers
  let cols = 0, rows = 0;

  function sizeCanvas() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = innerWidth, ch = innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${CELL - 2}px 'JetBrains Mono', monospace`;
    ctx.textBaseline = 'top';

    cols = Math.max(1, Math.floor(cw / CELL));
    rows = Math.max(1, Math.floor(ch / CELL));
    Module._rain_init(cols, rows, (Date.now() >>> 0));
  }

  sizeCanvas();
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (running) sizeCanvas(); // otherwise start() will re-size when quality recovers
    }, 200);
  }, { passive: true });

  let lastTs = 0;
  let running = false; // guards against a duplicate loop if resumed while already running

  function frame(ts) {
    if (!running) return; // stopped (quality dropped to minimal) — don't reschedule

    if (!(perfMgr ? perfMgr.isVisible() : !document.hidden)) {
      lastTs = ts;
      requestAnimationFrame(frame);
      return;
    }

    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.25) : 1 / 60;
    lastTs = ts;
    Module._rain_step(dt);

    const bPtr = Module._rain_brightness_ptr();
    const gPtr = Module._rain_glyph_ptr();
    const n = cols * rows;
    const brightness = Module.HEAPU8.subarray(bPtr, bPtr + n);
    const glyph = Module.HEAPU8.subarray(gPtr, gPtr + n);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Batch by quantized brightness bucket instead of setting ctx.fillStyle
    // per cell. The old loop built a fresh rgba() string and re-assigned
    // fillStyle for essentially every filled cell (alpha varies per-cell,
    // so consecutive cells almost never shared a style) — a canvas state
    // change on every fillText call. Bucketing brightness into 16 levels
    // and drawing bucket-by-bucket means at most 16 fillStyle assignments
    // per frame regardless of how many hundreds of glyphs are on screen,
    // for a visual difference (16 alpha steps vs. continuous) nobody will
    // notice in a matrix-rain effect.
    const BUCKETS = 16;
    if (!frame._bucketed) frame._bucketed = Array.from({ length: BUCKETS }, () => []);
    const bucketed = frame._bucketed;
    for (let k = 0; k < BUCKETS; k++) bucketed[k].length = 0;

    for (let row = 0; row < rows; row++) {
      const base = row * cols;
      for (let col = 0; col < cols; col++) {
        const b = brightness[base + col];
        if (b === 0) continue;
        const bucket = (b * (BUCKETS - 1) / 255) | 0;
        bucketed[bucket].push(base + col);
      }
    }

    for (let k = 0; k < BUCKETS; k++) {
      const idxs = bucketed[k];
      if (!idxs.length) continue;
      const alpha = (k + 0.5) / BUCKETS;
      // Same bright-head / cyan-tail split as before, just applied per
      // bucket instead of per cell.
      ctx.fillStyle = k >= 12
        ? `rgba(230,255,250,${alpha})`
        : `rgba(0,255,231,${alpha * 0.85})`;
      for (let m = 0; m < idxs.length; m++) {
        const cellIdx = idxs[m];
        const r = (cellIdx / cols) | 0;
        const c = cellIdx - r * cols;
        ctx.fillText(glyphFor(glyph[cellIdx]), c * CELL, r * CELL);
      }
    }

    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTs = 0;
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false; // frame() will see this and simply not reschedule itself
    canvas.style.display = 'none';
    Module._rain_free_buffers();
  }

  start();

  if (perfMgr) {
    perfMgr.onChange((q) => {
      if (q === 'minimal') {
        stop();
      } else if (!running) {
        // Quality recovered from minimal (e.g. the perf monitor re-measured
        // a healthy frame rate) — reinit the sim for the current viewport
        // and resume painting.
        canvas.style.display = '';
        sizeCanvas();
        start();
      }
    });
  }
})();
