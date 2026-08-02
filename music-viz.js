// music-viz.js — Canvas 2D frequency-bar visualizer for the music player.
// Replaces the old three.js audio-reactive orb: same Web Audio analyser,
// but painted as flat 2D bars instead of a WebGL wireframe mesh. Falls
// back to the static CSS .mp-eq bars if Web Audio can't be wired up.

(() => {
  const mpEl = document.getElementById('mp');
  const canvas = document.getElementById('mpViz');
  const aud = document.getElementById('bgMusic');
  const mpBtn = document.getElementById('mpBtn');
  if (!mpEl || !canvas || !aud || !mpBtn) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const perfMgr = window.PerfManager;
  const quality = perfMgr ? perfMgr.quality : 'medium';
  if (quality === 'minimal' || quality === 'low') return;

  let analyser, freq;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    freq = new Uint8Array(analyser.frequencyBinCount);
    audioCtx.createMediaElementSource(aud).connect(analyser);
    analyser.connect(audioCtx.destination);
    mpBtn.addEventListener('click', () => audioCtx.resume().catch(() => {}), { passive: true });
    if (audioCtx.state === 'suspended') {
      document.addEventListener('pointerdown', () => audioCtx.resume().catch(() => {}), { once: true, passive: true });
    }
  } catch (err) {
    console.warn('music-viz: Web Audio unavailable, keeping CSS eq bars', err);
    return;
  }

  mpEl.classList.add('viz-active'); // reveals the pod, so clientWidth below is real

  const ctx2d = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let size = 40;
  function resize() {
    size = canvas.clientWidth || size;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  const BARS = 10;
  (function draw() {
    requestAnimationFrame(draw);
    if (aud.paused) return;
    analyser.getByteFrequencyData(freq);
    ctx2d.clearRect(0, 0, size, size);
    const step = Math.max(1, Math.floor(freq.length / BARS));
    const barW = size / BARS;
    for (let i = 0; i < BARS; i++) {
      const h = Math.max(2, (freq[i * step] / 255) * size * 0.9);
      ctx2d.fillStyle = i % 2 ? '#ff2e9a' : '#00ffe7';
      ctx2d.fillRect(i * barW + 1, size - h, barW - 2, h);
    }
  })();
})();
