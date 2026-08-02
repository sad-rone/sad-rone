'use strict';
(function initPerfManager() {
    const listeners = [];
    const skipCounters = {};
    let visible = !document.hidden;
    let quality = guessInitialQuality();
    function guessInitialQuality() {
        const nav = navigator;
        const cores = nav.hardwareConcurrency || 4;
        const mem = nav.deviceMemory || 4;
        const saveData = !!(nav.connection && nav.connection.saveData);
        const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const smallScreen = matchMedia('(max-width: 640px)').matches;
        if (reduceMotion)
            return 'minimal';
        if (saveData || cores <= 2 || mem <= 2)
            return 'low';
        if (smallScreen || cores <= 4 || mem <= 4)
            return 'medium';
        return 'high';
    }
    function applyQuality(next) {
        if (next === quality)
            return;
        quality = next;
        document.documentElement.dataset.perf = quality;
        for (const cb of listeners.slice()) {
            try {
                cb(quality);
            }
            catch (_a) { /* one bad listener shouldn't break the rest */ }
        }
    }
    document.addEventListener('visibilitychange', () => {
        visible = !document.hidden;
    }, { passive: true });
    // Re-check the static signals on resize/orientation change (e.g. rotating
    // a tablet, or a small-screen media query flipping) — still no per-frame
    // sampling, just re-running the same cheap guess.
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => applyQuality(guessInitialQuality()), 200);
    }, { passive: true });
    document.documentElement.dataset.perf = quality;
    const api = {
        get quality() { return quality; },
        onChange(cb) {
            listeners.push(cb);
            return () => {
                const i = listeners.indexOf(cb);
                if (i > -1)
                    listeners.splice(i, 1);
            };
        },
        shouldSkipFrame(everyNth, id) {
            if (everyNth <= 1)
                return false;
            const n = ((skipCounters[id] || 0) + 1) % everyNth;
            skipCounters[id] = n;
            return n !== 0;
        },
        isVisible() { return visible; },
    };
    window.PerfManager = api;
})();