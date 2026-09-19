
(function mountPerfWidget() {
    const w = window;
    const mgr = w.PerfManager;
    const React = w.React;
    const ReactDOM = w.ReactDOM;
    if (!mgr || !React || !ReactDOM)
        return; // perf.js / CDN scripts missing — skip silently
    const { useState, useEffect, createElement: h } = React;
    const TIER_COLOR = {
        high: '#39ff14',
        medium: '#00ffe7',
        low: '#ffb800',
        minimal: '#ff2e9a',
    };
    function PerfHUD() {
        const [visible, setVisible] = useState(false);
        const [quality, setQuality] = useState(mgr.quality);
        useEffect(() => {
            const onKey = (e) => {
                if (e.shiftKey && (e.key === 'P' || e.key === 'p'))
                    setVisible((v) => !v);
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }, []);
        useEffect(() => {
            
            const offChange = mgr.onChange(setQuality);
            return () => offChange();
        }, []);
        if (!visible)
            return null;
        const color = TIER_COLOR[quality] || TIER_COLOR.high;
        return h('div', {
            style: {
                position: 'fixed', bottom: '64px', left: '16px', zIndex: 9990,
                fontFamily: "'JetBrains Mono', monospace", fontSize: '10px',
                letterSpacing: '.5px', padding: '6px 10px', borderRadius: '4px',
                background: 'rgba(0,0,5,.85)', border: `1px solid ${color}55`,
                color, boxShadow: `0 0 12px ${color}33`,
                pointerEvents: 'none', userSelect: 'none',
            },
        }, h('span', null, 'PERF'), h('span', { style: { opacity: 0.5, margin: '0 6px' } }, '\u00b7'), h('span', null, String(quality).toUpperCase()), h('span', { style: { opacity: 0.35, marginLeft: '8px' } }, 'shift+p to hide'));
    }
    const root = document.createElement('div');
    root.id = 'perf-hud-root';
    document.body.appendChild(root);
    ReactDOM.createRoot(root).render(h(PerfHUD));
})();
