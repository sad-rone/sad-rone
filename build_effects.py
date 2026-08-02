import sys
from pathlib import Path

CSS_PATH = Path("style.css")

BLOCK_START = "/* EFFECTS:AUTO */"
BLOCK_END = "/* /EFFECTS:AUTO */"

BLOCK = f"""{BLOCK_START}
#cur-dot {{
  width: 9px; height: 9px;
  background: radial-gradient(circle at 30% 30%, #fff, var(--cyan) 40%, var(--violet) 100%);
  box-shadow: 0 0 6px var(--cyan), 0 0 16px rgba(0,255,231,.5), 0 0 28px rgba(168,85,247,.3);
  animation: dotPulse 1.8s ease-in-out infinite;
}}
@keyframes dotPulse {{
  0%, 100% {{ box-shadow: 0 0 6px var(--cyan), 0 0 16px rgba(0,255,231,.5), 0 0 28px rgba(168,85,247,.3); }}
  50% {{ box-shadow: 0 0 10px var(--cyan), 0 0 24px rgba(0,255,231,.7), 0 0 40px rgba(168,85,247,.45); }}
}}
#cur-ring {{
  width: 30px; height: 30px;
  border: 1.5px solid rgba(0,255,231,.5);
  box-shadow: 0 0 12px rgba(0,255,231,.25), inset 0 0 12px rgba(0,255,231,.08);
  animation: ringHue 6s linear infinite;
}}
@keyframes ringHue {{
  0% {{ filter: hue-rotate(0deg); }}
  100% {{ filter: hue-rotate(360deg); }}
}}
body.hov #cur-dot {{
  background: radial-gradient(circle at 30% 30%, #fff, var(--magenta) 40%, var(--violet) 100%);
  box-shadow: 0 0 8px var(--magenta), 0 0 20px rgba(255,46,154,.6), 0 0 34px rgba(168,85,247,.35);
}}
body.hov #cur-ring {{
  width: 42px; height: 42px;
  border-color: rgba(255,46,154,.6);
  box-shadow: 0 0 16px rgba(255,46,154,.3), inset 0 0 16px rgba(255,46,154,.1);
}}

/* contextual accent — set at runtime via --cursor-accent / --cursor-glow-1/2 */
body.hov #cur-dot {{
  background: radial-gradient(circle at 30% 30%, #fff, var(--cursor-accent, var(--magenta)) 40%, var(--violet) 100%);
  box-shadow: 0 0 8px var(--cursor-accent, var(--magenta)), 0 0 20px var(--cursor-glow-1, rgba(255,46,154,.6)), 0 0 34px rgba(168,85,247,.35);
}}
body.hov #cur-ring {{
  border-color: var(--cursor-accent, rgba(255,46,154,.6));
  box-shadow: 0 0 16px var(--cursor-glow-2, rgba(255,46,154,.3)), inset 0 0 16px var(--cursor-glow-2, rgba(255,46,154,.1));
}}
/* contextual shape — toggled at runtime via body[data-cursor-shape] */
body[data-cursor-shape="square"] #cur-ring {{ border-radius: 10px; }}
body[data-cursor-shape="square"] #cur-dot  {{ border-radius: 3px; }}

/* cursor trail */
.cur-trail {{
  position: fixed; top: 0; left: 0;
  border-radius: 50%;
  background: var(--cyan);
  pointer-events: none; z-index: 9995;
  will-change: transform;
}}
body.hov .cur-trail {{ background: var(--cursor-accent, var(--magenta)); }}

/* magnetic hover elements */
.magnetic {{
  transition: transform .25s cubic-bezier(.16,1,.3,1);
  will-change: transform;
}}

/* adaptive quality — html[data-perf] is set live by perf.js based on
   measured frame timing, not just a one-time device guess */
html[data-perf="minimal"] #cur-dot,
html[data-perf="minimal"] #cur-ring,
html[data-perf="minimal"] .ascii-name {{
  animation: none !important;
}}
html[data-perf="minimal"] .cur-trail {{ display: none; }}
html[data-perf="low"] #cur-ring {{ animation-duration: 12s; }}

.ascii-name {{
  background: linear-gradient(90deg, var(--cyan), var(--magenta), var(--violet), var(--cyan));
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 18px rgba(255,46,154,.55), 0 0 36px rgba(0,255,231,.35), 0 0 60px rgba(168,85,247,.25);
  animation: glowPulse 4s steps(8, jump-none) infinite, nameFlow 6s linear infinite;
}}
@keyframes nameFlow {{
  0% {{ background-position: 0% 50%; }}
  100% {{ background-position: 300% 50%; }}
}}
@keyframes glowPulse {{
  0%, 100% {{ text-shadow: 0 0 18px rgba(255,46,154,.55), 0 0 36px rgba(0,255,231,.35), 0 0 60px rgba(168,85,247,.25); }}
  50% {{ text-shadow: 0 0 28px rgba(255,46,154,.85), 0 0 55px rgba(0,255,231,.55), 0 0 90px rgba(168,85,247,.4); }}
}}
{BLOCK_END}"""


def inject(css):
    start = css.find(BLOCK_START)
    end = css.find(BLOCK_END)
    if start != -1 and end != -1:
        return css[:start] + BLOCK + css[end + len(BLOCK_END):]
    return css.rstrip() + "\n\n" + BLOCK + "\n"


def main():
    if not CSS_PATH.exists():
        sys.exit("style.css not found in current folder")
    css = CSS_PATH.read_text(encoding="utf-8")
    CSS_PATH.write_text(inject(css), encoding="utf-8")
    print("style.css updated with glowing cursor + gradient SANDRONE banner")


if __name__ == "__main__":
    main()
