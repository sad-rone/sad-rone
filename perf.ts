'use strict';

/**
 * perf.ts — lightweight adaptive-quality manager.
 *
 * Picks a quality tier once at load time from device signals
 * (CPU cores, RAM, Save-Data, reduced-motion, screen size) and exposes it —
 * plus a couple of small helpers — on `window.PerfManager` so any other
 * script (or CSS, via `html[data-perf]`) can scale itself down on weaker
 * devices without re-implementing this detection.
 *
 * No runtime FPS sampling: no rAF loop, no PerformanceObserver, no periodic
 * re-evaluation. The tier is decided once and stays put — cheaper and
 * simpler, at the cost of not reacting to mid-session slowdowns.
 *
 * No framework, no build step required beyond `tsc` — this compiles to a
 * plain classic script (tsconfig.json uses module "commonjs", but since
 * this file has no import/export statements, no module wrapper is ever
 * emitted) and is loaded
 * with a plain <script> tag before scripts.js.
 */

type Quality = 'high' | 'medium' | 'low' | 'minimal';

interface PerfManagerAPI {
  readonly quality: Quality;
  /** Subscribe to quality-tier changes. Returns an unsubscribe function. */
  onChange(cb: (quality: Quality) => void): () => void;
  /**
   * Frame-skip helper for expensive per-frame work (e.g. particle redraw).
   * Call once per rAF tick with the same `id`; returns true on frames that
   * should be skipped so the caller does 1-in-N of its usual work.
   */
  shouldSkipFrame(everyNth: number, id: string): boolean;
  isVisible(): boolean;
}

(function initPerfManager(): void {
  const listeners: Array<(q: Quality) => void> = [];
  const skipCounters: Record<string, number> = {};

  let visible = !document.hidden;
  let quality: Quality = guessInitialQuality();

  function guessInitialQuality(): Quality {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    const cores = nav.hardwareConcurrency || 4;
    const mem = nav.deviceMemory || 4;
    const saveData = !!(nav.connection && nav.connection.saveData);
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const smallScreen = matchMedia('(max-width: 640px)').matches;

    if (reduceMotion) return 'minimal';
    if (saveData || cores <= 2 || mem <= 2) return 'low';
    if (smallScreen || cores <= 4 || mem <= 4) return 'medium';
    return 'high';
  }

  function applyQuality(next: Quality): void {
    if (next === quality) return;
    quality = next;
    document.documentElement.dataset.perf = quality;
    for (const cb of listeners.slice()) {
      try { cb(quality); } catch { /* one bad listener shouldn't break the rest */ }
    }
  }

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
  }, { passive: true });

  // Re-check the static signals on resize/orientation change (e.g. rotating
  // a tablet, or a small-screen media query flipping) — still no per-frame
  // sampling, just re-running the same cheap guess.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => applyQuality(guessInitialQuality()), 200);
  }, { passive: true });

  document.documentElement.dataset.perf = quality;

  const api: PerfManagerAPI = {
    get quality() { return quality; },
    onChange(cb) {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i > -1) listeners.splice(i, 1);
      };
    },
    shouldSkipFrame(everyNth, id) {
      if (everyNth <= 1) return false;
      const n = ((skipCounters[id] || 0) + 1) % everyNth;
      skipCounters[id] = n;
      return n !== 0;
    },
    isVisible() { return visible; },
  };

  (window as unknown as { PerfManager: PerfManagerAPI }).PerfManager = api;
})();