
import init, { ParticleSystem } from './pkg/particle_system.js';

(async () => {
  const pc = document.getElementById('pCanvas');
  if (!pc) return;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    pc.style.display = 'none';
    return;
  }

  const perfMgr = window.PerfManager;
  const quality = perfMgr ? perfMgr.quality : 'medium';
  if (quality === 'minimal') {
    pc.style.display = 'none';
    return;
  }

  await init(); // fetches + instantiates pkg/particle_system_bg.wasm
  pc.classList.add('ready'); // CSS fades opacity 0 -> 1 (see style.css)

  let system = new ParticleSystem(
    pc,
    innerWidth,
    innerHeight,
    quality,
    (Date.now() >>> 0)
  );

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => system && system.resize(innerWidth, innerHeight), 200);
  }, { passive: true });

  if (perfMgr) {
    perfMgr.onChange((q) => {
      if (q === 'minimal') {
        if (!system) return;
        system.destroy();
        pc.classList.remove('ready');
        pc.style.display = 'none';
        window.__particlesStep = null;
        system = null;
        return;
      }
      if (!system) {
        // Recovering from minimal — re-create rather than leaving the
        // canvas permanently blank for the rest of the session.
        pc.style.display = '';
        system = new ParticleSystem(pc, innerWidth, innerHeight, q, (Date.now() >>> 0));
        pc.classList.add('ready');
        window.__particlesStep = (timestampMs) => system && system.step(timestampMs);
        return;
      }
      system.set_quality(q);
    });
  }

  // scripts.js's existing masterLoop drives one single requestAnimationFrame
  // for the whole page (ring, trail, magnetic hover, particles). Rather than
  // run a second rAF loop here, expose a step function it can call — same
  // low/skip-frame throttling logic in scripts.js keeps working unchanged,
  // it just calls into WASM instead of the old JS particlesStep().
  window.__particlesStep = (timestampMs) => system && system.step(timestampMs);
})();
