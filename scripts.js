'use strict';

const reduceMotion  = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ric = window.requestIdleCallback || (cb => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1));

let tabHidden = document.hidden;

const perfMgr = window.PerfManager;
const lowPower = perfMgr
  ? (perfMgr.quality === 'low' || perfMgr.quality === 'minimal')
  : (matchMedia('(max-width: 640px)').matches ||
     (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4));

// --- video: just let native loop handle it, no JS fade ---
const vid = document.getElementById('bgVid');
vid.play().catch(() => {});

// --- ripple on click -------------------------------------------------------
document.addEventListener('click', e => {
  const r = document.createElement('div');
  r.className = 'rip';
  r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
  document.body.appendChild(r);
  r.addEventListener('animationend', () => r.remove(), { once: true });
});

// --- boot ------------------------------------------------------------------
let bootDone = false;
const bootEl = document.getElementById('boot');
const markBootDone = () => { bootDone = true; };
bootEl.addEventListener('animationend', markBootDone, { once: true });
setTimeout(markBootDone, 3700);

// --- masterLoop (nothing left to drive per-frame outside star canvas) ------
// kept minimal — just visibility/tab management
document.addEventListener('visibilitychange', () => {
  tabHidden = document.hidden;
  clearInterval(titleFlickerIv);
  titleFlickerIv = null;
  if (tabHidden) {
    vid.pause();
    let tog = false;
    titleFlickerIv = setInterval(() => { document.title = tog ? '> come back...' : '[ you left ]'; tog = !tog; }, 900);
    setTimeout(() => { clearInterval(titleFlickerIv); titleFlickerIv = null; }, 10000);
  } else {
    vid.play().catch(() => {});
    document.title = '~/profile';
  }
}, { passive: true });

let titleFlickerIv = null;

// --- music player ----------------------------------------------------------
const aud   = document.getElementById('bgMusic');
const mpEl  = document.getElementById('mp');
const mpBtn = document.getElementById('mpBtn');
const seek  = document.getElementById('mpSeek');
const mpCur = document.getElementById('mpCur');
const mpDur = document.getElementById('mpDur');
const TV    = 0.5;
aud.volume  = 0;
if (lowPower) mpEl.classList.add('no-blur');

const fmt = s => isFinite(s) ? `${0|s/60}:${(0|s%60).toString().padStart(2,'0')}` : '0:00';
const fadeVol = (to, ms = 700) => {
  const s = aud.volume, t0 = performance.now();
  (function step(n) { const t = Math.min(1, (n - t0) / ms); aud.volume = s + (to - s) * t; if (t < 1) requestAnimationFrame(step); })(performance.now());
};
const setUI = on => {
  mpBtn.classList.toggle('on', on);
  mpBtn.setAttribute('aria-pressed', String(on));
  mpEl.classList.toggle('playing', on);
};

aud.addEventListener('loadedmetadata', () => { mpDur.textContent = fmt(aud.duration); });

let seeking = false;
aud.addEventListener('timeupdate', () => {
  if (seeking || !aud.duration) return;
  const p = (aud.currentTime / aud.duration) * 1000;
  seek.value = p; seek.style.setProperty('--fill', (p / 10) + '%');
  mpCur.textContent = fmt(aud.currentTime);
});
seek.addEventListener('input', () => {
  seeking = true;
  seek.style.setProperty('--fill', (seek.value / 10) + '%');
  if (aud.duration) mpCur.textContent = fmt((seek.value / 1000) * aud.duration);
});
seek.addEventListener('change', () => { if (aud.duration) aud.currentTime = (seek.value / 1000) * aud.duration; seeking = false; });

mpBtn.addEventListener('click', () => {
  if (aud.paused) { aud.play().then(() => { fadeVol(TV); setUI(true); }).catch(() => {}); }
  else { fadeVol(0, 250); setTimeout(() => aud.pause(), 260); setUI(false); }
});
aud.play().then(() => { fadeVol(TV); setUI(true); }).catch(() => setUI(false));

// --- typewriter bio --------------------------------------------------------
const LINES = [
  '// for programming enthusiasts and full-stack dev //',
  '// building everything at 3 am with neon lights ( neon lights are ridiculously expensive ) //',
  '// coffee.exe has stopped responding. Why is not it crashing ?? //',
  '// `git commit -m` works on my machine i thought it was handled by python a long time ago zz"//',
  '// i spent a whole night just working on this and I got absolutely nothing in return.... //'
];
const bioEl = document.getElementById('bioEl');
let li = 0, ci = 0, del = false;
function type() {
  const full = LINES[li];
  if (!del) { ci++; bioEl.innerHTML = full.slice(0, ci) + '<span class="cur" aria-hidden="true"></span>'; if (ci === full.length) { del = true; setTimeout(type, 1700); return; } }
  else { ci--; bioEl.innerHTML = full.slice(0, ci) + '<span class="cur" aria-hidden="true"></span>'; if (ci === 0) { del = false; li = (li + 1) % LINES.length; } }
  setTimeout(type, del ? 26 : 50);
}
if (reduceMotion) { bioEl.textContent = LINES[0].replace(/^\/\/\s*/, ''); }
else { setTimeout(type, 4000); }

// --- glitch ascii ----------------------------------------------------------
if (!reduceMotion) {
  const asc = document.getElementById('asciiName');
  function glitchAsc() {
    asc.classList.add('go');
    setTimeout(() => asc.classList.remove('go'), 160);
    setTimeout(glitchAsc, 3000 + Math.random() * 5000);
  }
  setTimeout(glitchAsc, 4500);
}

// --- skill bars ------------------------------------------------------------
setTimeout(() => {
  document.querySelectorAll('.sk-fill').forEach(el => { el.style.width = el.dataset.w + '%'; });
}, 3800);

// --- uptime ----------------------------------------------------------------
const startTs = Date.now() - (Math.random() * 8.64e7 * 200);
const uptEl = document.getElementById('uptime');
function updUptime() {
  const s = Math.floor((Date.now() - startTs) / 1000);
  const d = 0 | s / 86400, h = 0 | (s % 86400) / 3600;
  uptEl.textContent = `${d}d${h}h`;
}
updUptime(); setInterval(updUptime, 60000);

// --- view counter ----------------------------------------------------------
const VIEW_API = window.VIEW_API_BASE || '/api/views';
ric(() => {
  const viewEl = document.getElementById('viewCount');
  const countUpTo = target => {
    let cur = 0;
    (function count() {
      cur = Math.min(target, cur + Math.ceil(Math.max(target, 1) / 80));
      viewEl.textContent = cur.toLocaleString();
      if (cur < target) requestAnimationFrame(count);
    })();
  };
  fetch(VIEW_API, { method: 'POST' })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => countUpTo(Number(data.views) || 0))
    .catch(err => { console.warn('view counter unavailable:', err); viewEl.textContent = '—'; });
});

// --- konami / snake --------------------------------------------------------
const SEQ = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let kIdx = 0;
const konamiEl    = document.getElementById('konami');
const konamiClose = document.getElementById('konamiClose');
const snakeC      = document.getElementById('snakeCanvas');
const sCtx        = snakeC.getContext('2d');
const CELL = 15, COLS = 20, ROWS = 20;
let snake, dir, food, gameLoop, score, lastFocused = null;

function initSnake() {
  snake = [{x:10,y:10},{x:9,y:10},{x:8,y:10}];
  dir = {x:1,y:0}; score = 0;
  placeFood(); clearInterval(gameLoop);
  gameLoop = setInterval(tickSnake, 110);
}
function placeFood() { food = {x:0|Math.random()*COLS, y:0|Math.random()*ROWS}; }
function tickSnake() {
  const head = {x:snake[0].x+dir.x, y:snake[0].y+dir.y};
  if (head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS||snake.some(s=>s.x===head.x&&s.y===head.y)) {
    clearInterval(gameLoop); drawSnake('GAME OVER'); return;
  }
  snake.unshift(head);
  if (head.x===food.x&&head.y===food.y) { score++; placeFood(); } else snake.pop();
  drawSnake();
}
function drawSnake(msg) {
  sCtx.fillStyle='#000005'; sCtx.fillRect(0,0,snakeC.width,snakeC.height);
  sCtx.strokeStyle='rgba(0,255,231,.05)';
  for(let x=0;x<COLS;x++) for(let y=0;y<ROWS;y++){sCtx.strokeRect(x*CELL,y*CELL,CELL,CELL);}
  snake.forEach((s,i)=>{
    sCtx.fillStyle = i===0 ? '#00ffe7' : `rgba(0,255,231,${0.4+0.6*(1-i/snake.length)})`;
    if(i===0){sCtx.shadowColor='#00ffe7';sCtx.shadowBlur=8;}else{sCtx.shadowBlur=0;}
    sCtx.fillRect(s.x*CELL+1,s.y*CELL+1,CELL-2,CELL-2);
  });
  sCtx.shadowBlur=0;
  sCtx.fillStyle='#ff2e9a'; sCtx.shadowColor='#ff2e9a'; sCtx.shadowBlur=8;
  sCtx.fillRect(food.x*CELL+2,food.y*CELL+2,CELL-4,CELL-4);
  sCtx.shadowBlur=0;
  sCtx.font='10px JetBrains Mono'; sCtx.fillStyle='rgba(0,255,231,.5)'; sCtx.fillText(`SCORE: ${score}`,6,14);
  if(msg){
    sCtx.font='bold 18px JetBrains Mono'; sCtx.fillStyle='#ff2e9a'; sCtx.shadowColor='#ff2e9a'; sCtx.shadowBlur=12;
    sCtx.fillText(msg, snakeC.width/2-52, snakeC.height/2);
    sCtx.shadowBlur=0;
    setTimeout(initSnake, 1500);
  }
}
function openKonami() {
  lastFocused = document.activeElement;
  konamiEl.classList.add('show'); konamiEl.setAttribute('aria-hidden','false');
  initSnake(); konamiClose.focus();
}
function closeKonami() {
  konamiEl.classList.remove('show'); konamiEl.setAttribute('aria-hidden','true');
  clearInterval(gameLoop);
  if (lastFocused && lastFocused.focus) lastFocused.focus();
}
document.addEventListener('keydown', e => {
  if (!konamiEl.classList.contains('show')) {
    if (e.key === SEQ[kIdx]) { kIdx++; if(kIdx===SEQ.length){openKonami();kIdx=0;} }
    else { kIdx = e.key===SEQ[0]?1:0; }
  }
  if (konamiEl.classList.contains('show')) {
    const map={'ArrowUp':{x:0,y:-1},'ArrowDown':{x:0,y:1},'ArrowLeft':{x:-1,y:0},'ArrowRight':{x:1,y:0}};
    if (map[e.key] && !(map[e.key].x===-dir.x&&map[e.key].y===-dir.y)) dir=map[e.key];
    if (e.key==='Escape') closeKonami();
    e.preventDefault();
  }
});
konamiClose.addEventListener('click', closeKonami);

// --- discord copy ----------------------------------------------------------
const discordBtn = document.getElementById('discordCopy');
const discordLbl = document.getElementById('discordCopyLbl');
discordBtn.addEventListener('click', async () => {
  const text = 'aumygot_';
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) {}
    document.body.removeChild(ta);
  }
  discordLbl.textContent = 'COPIED';
  discordBtn.classList.add('copied');
  setTimeout(() => { discordLbl.textContent = 'DISCORD'; discordBtn.classList.remove('copied'); }, 1600);
});