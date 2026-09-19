

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

  
  const CHARSET = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>/\\|=+*:.-_';
  const glyphFor = (idx) => CHARSET[idx % CHARSET.length];

  const CELL = quality === 'high' ? 16 : 20; 
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
      if (running) sizeCanvas(); 
    }, 200);
  }, { passive: true });

  let lastTs = 0;
  let running = false; 

  function frame(ts) {
    if (!running) return; 

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
    running = false; 
    canvas.style.display = 'none';
    Module._rain_free_buffers();
  }

  start();

  if (perfMgr) {
    perfMgr.onChange((q) => {
      if (q === 'minimal') {
        stop();
      } else if (!running) {
        
        canvas.style.display = '';
        sizeCanvas();
        start();
      }
    });
  }
})();
