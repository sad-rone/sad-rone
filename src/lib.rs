//! Cyberpunk profile background particle system — compiled to WASM.
//!
//! Replaces the particle block that used to live in `scripts.js`. The goal
//! isn't just "same thing but Rust" — it's:
//!
//!  - **Performance**: the whole hot path (physics update for every
//!    particle, every frame) runs as compiled WASM instead of interpreted /
//!    JIT-warmed JS. No per-frame allocations, no closures, one contiguous
//!    block of memory per field (struct-of-arrays), delta-time based motion
//!    so it stays correct regardless of the display's refresh rate.
//!  - **Prettier**: depth (parallax: far particles are smaller/dimmer/
//!    slower), a soft twinkle instead of a flat linear fade, a bright
//!    specular core on each sprite instead of a flat-color center, and —
//!    only on the `high` quality tier, so it stays cheap — faint
//!    "constellation" links between nearby particles.
//!
//! `quality` ("high" | "medium" | "low" | "minimal") is meant to come
//! straight from `window.PerfManager.quality` (see perf.ts). JS decides
//! *whether* to instantiate this at all (skip entirely on `minimal` /
//! reduced-motion) and calls `set_quality()` when perf.ts reports a tier
//! change mid-session.

use std::f32::consts::TAU;
use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

const SPRITE_R: u32 = 7;
const LINK_DIST: f32 = 110.0;
const LINK_DIST_SQ: f32 = LINK_DIST * LINK_DIST;
const MS_PER_FRAME: f64 = 1000.0 / 60.0; // reference frame time for scaling velocities
const PALETTE: [&str; 4] = ["#ff2e9a", "#00ffe7", "#a855f7", "#39ff14"];

/// Tiny xorshift32 PRNG. Avoids crossing back into JS (`Math.random()`) on
/// every particle respawn, and avoids pulling in the `rand` crate (which
/// wants `getrandom`, which is extra ceremony for something this simple).
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Self {
        Rng(if seed == 0 { 0x9E3779B9 } else { seed })
    }

    fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// Uniform float in [0, 1).
    fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }
}

fn quality_factor(quality: &str) -> f32 {
    match quality {
        "high" => 1.7,
        "medium" => 1.0,
        "low" => 0.5,
        _ => 0.35, // "minimal" — JS normally won't instantiate at all, but be safe
    }
}

fn links_allowed(quality: &str) -> bool {
    quality == "high"
}

fn base_count(width: f64) -> usize {
    if width <= 640.0 {
        16
    } else {
        35
    }
}

#[wasm_bindgen]
pub struct ParticleSystem {
    canvas: HtmlCanvasElement,
    ctx: CanvasRenderingContext2d,
    sprites: Vec<HtmlCanvasElement>,

    width: f64,
    height: f64,

    // Struct-of-arrays particle state. Kept as plain Vecs (not typed arrays
    // shared with JS) since all reads/writes happen on the Rust side now —
    // JS never touches these directly.
    x: Vec<f32>,
    y: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
    alpha: Vec<f32>,
    fade: Vec<f32>,
    scale: Vec<f32>,
    depth: Vec<f32>,   // 0.4..1.0 — parallax factor, affects size/speed/opacity
    phase: Vec<f32>,   // twinkle / drift phase offset per particle
    color_idx: Vec<u8>,

    count: usize,
    links_enabled: bool,
    quality: String,

    last_ts: f64,
    time_ms: f64, // running clock used for twinkle/drift, immune to tab-hidden jumps
    rng: Rng,
}

#[wasm_bindgen]
impl ParticleSystem {
    /// Create and mount a particle system on the given canvas element.
    ///
    /// `seed` should just be `Date.now() >>> 0` from the JS side — it only
    /// needs to differ run to run, it isn't cryptographic.
    #[wasm_bindgen(constructor)]
    pub fn new(
        canvas: HtmlCanvasElement,
        width: f64,
        height: f64,
        quality: &str,
        seed: u32,
    ) -> Result<ParticleSystem, JsValue> {
        let ctx = canvas
            .get_context("2d")?
            .ok_or_else(|| JsValue::from_str("2d context unavailable"))?
            .dyn_into::<CanvasRenderingContext2d>()?;

        canvas.set_width(width.max(0.0) as u32);
        canvas.set_height(height.max(0.0) as u32);

        let sprites = build_sprites(&canvas)?;

        let mut sys = ParticleSystem {
            canvas,
            ctx,
            sprites,
            width,
            height,
            x: Vec::new(),
            y: Vec::new(),
            vx: Vec::new(),
            vy: Vec::new(),
            alpha: Vec::new(),
            fade: Vec::new(),
            scale: Vec::new(),
            depth: Vec::new(),
            phase: Vec::new(),
            color_idx: Vec::new(),
            count: 0,
            links_enabled: links_allowed(quality),
            quality: quality.to_string(),
            last_ts: 0.0,
            time_ms: 0.0,
            rng: Rng::new(0), // placeholder, replaced below
        };
        sys.rng = Rng::new(seed ^ 0xA5A5_5A5A);
        sys.resize_particle_count(target_count(width, quality));

        Ok(sys)
    }

    /// Call on window resize (debounced on the JS side — no need to call
    /// this on every `resize` event, once every ~200ms is plenty).
    pub fn resize(&mut self, width: f64, height: f64) {
        self.width = width;
        self.height = height;
        self.canvas.set_width(width.max(0.0) as u32);
        self.canvas.set_height(height.max(0.0) as u32);
        // Re-scale particle count for the new viewport / quality combo.
        self.resize_particle_count(target_count(width, &self.quality));
    }

    /// Call when `perfMgr.onChange` fires. Cheap: only touches particle
    /// count and whether constellation links are drawn.
    pub fn set_quality(&mut self, quality: &str) {
        if quality == self.quality {
            return;
        }
        self.quality = quality.to_string();
        self.links_enabled = links_allowed(quality);
        self.resize_particle_count(target_count(self.width, quality));
    }

    /// Advance the simulation and paint one frame. `timestamp_ms` should be
    /// the value handed to you by `requestAnimationFrame`.
    pub fn step(&mut self, timestamp_ms: f64) {
        let mut dt_ms = if self.last_ts > 0.0 {
            timestamp_ms - self.last_ts
        } else {
            MS_PER_FRAME
        };
        // Ignore huge gaps (backgrounded tab, devtools pause) so they don't
        // get misread as one giant leap.
        if !(0.0..=250.0).contains(&dt_ms) {
            dt_ms = MS_PER_FRAME;
        }
        self.last_ts = timestamp_ms;
        self.time_ms += dt_ms;
        let dt = (dt_ms / MS_PER_FRAME) as f32;

        self.ctx.clear_rect(0.0, 0.0, self.width, self.height);

        let t = self.time_ms as f32;
        let w = self.width as f32;
        let h = self.height as f32;

        for i in 0..self.count {
            let depth = self.depth[i];

            // Subtle sinusoidal wobble on top of the linear drift — reads as
            // gentle floating dust rather than particles on rails.
            let wobble = (t * 0.0011 + self.phase[i]).sin() * 0.12;

            self.x[i] += (self.vx[i] + wobble) * depth * dt;
            self.y[i] += self.vy[i] * depth * dt;
            self.alpha[i] -= self.fade[i] * dt;

            if self.alpha[i] <= 0.0 || self.y[i] < -20.0 {
                self.respawn(i, w, h);
                continue;
            }

            // Twinkle: gentle shimmer around the base alpha, brighter at the
            // peaks so particles read as faintly alive rather than a flat fade.
            let twinkle = 0.78 + 0.22 * (t * 0.0025 + self.phase[i] * 1.7).sin();
            let draw_alpha = (self.alpha[i] * twinkle * (0.5 + 0.5 * depth)).clamp(0.0, 1.0);

            let sz = (SPRITE_R * 2) as f32 * self.scale[i] * (0.6 + 0.4 * depth);
            let sprite = &self.sprites[self.color_idx[i] as usize % self.sprites.len()];

            self.ctx.set_global_alpha(draw_alpha as f64 * 0.85);
            let _ = self.ctx.draw_image_with_html_canvas_element_and_dw_and_dh(
                sprite,
                (self.x[i] - sz * 0.5) as f64,
                (self.y[i] - sz * 0.5) as f64,
                sz as f64,
                sz as f64,
            );
        }

        if self.links_enabled {
            self.draw_links();
        }

        self.ctx.set_global_alpha(1.0);
    }

    pub fn particle_count(&self) -> usize {
        self.count
    }

    /// Clear the canvas. Call before dropping the system (e.g. quality
    /// collapsed to "minimal" mid-session and JS is tearing this down).
    pub fn destroy(&mut self) {
        self.ctx.clear_rect(0.0, 0.0, self.width, self.height);
    }
}

impl ParticleSystem {
    fn respawn(&mut self, i: usize, w: f32, h: f32) {
        let depth = self.rng.next_f32() * 0.6 + 0.4; // 0.4..1.0
        self.x[i] = self.rng.next_f32() * w;
        self.y[i] = h + self.rng.next_f32() * 40.0; // spawn just below the fold, drift up into view
        self.vx[i] = (self.rng.next_f32() - 0.5) * 0.2;
        self.vy[i] = -(self.rng.next_f32() * 0.28 + 0.04);
        self.alpha[i] = self.rng.next_f32() * 0.6 + 0.2;
        self.fade[i] = self.rng.next_f32() * 0.002 + 0.0007;
        self.scale[i] = self.rng.next_f32() * 0.6 + 0.4;
        self.depth[i] = depth;
        self.phase[i] = self.rng.next_f32() * TAU;
        self.color_idx[i] = (self.rng.next_u32() % 4) as u8;
    }

    /// Grow or shrink all particle buffers to `target`, initializing any
    /// newly-added slots. Existing particles are left in place (no visible
    /// pop when the tier changes mid-session).
    fn resize_particle_count(&mut self, target: usize) {
        let w = self.width as f32;
        let h = self.height as f32;
        let old = self.count;

        self.x.resize(target, 0.0);
        self.y.resize(target, 0.0);
        self.vx.resize(target, 0.0);
        self.vy.resize(target, 0.0);
        self.alpha.resize(target, 0.0);
        self.fade.resize(target, 0.001);
        self.scale.resize(target, 0.5);
        self.depth.resize(target, 0.7);
        self.phase.resize(target, 0.0);
        self.color_idx.resize(target, 0);

        self.count = target;
        for i in old..target {
            self.respawn(i, w, h);
            // Scatter initial Y across the full height instead of all
            // spawning at the bottom, so growth doesn't look like a burst.
            self.y[i] = self.rng.next_f32() * h;
        }
    }

    fn draw_links(&self) {
        if self.count < 2 {
            return;
        }
        self.ctx.set_line_width(1.0);
        // Static cyan stroke; per-pair opacity is the only thing that varies,
        // so we never build a color string in the hot loop.
        self.ctx.set_stroke_style_str("#00ffe7");

        for i in 0..self.count {
            for j in (i + 1)..self.count {
                let dx = self.x[i] - self.x[j];
                let dy = self.y[i] - self.y[j];
                let d2 = dx * dx + dy * dy;
                if d2 >= LINK_DIST_SQ {
                    continue;
                }
                let d = d2.sqrt();
                let closeness = 1.0 - d / LINK_DIST;
                let a = closeness * closeness * 0.16
                    * self.alpha[i].min(self.alpha[j])
                    * self.depth[i].min(self.depth[j]);
                if a <= 0.004 {
                    continue;
                }
                self.ctx.set_global_alpha(a as f64);
                self.ctx.begin_path();
                self.ctx.move_to(self.x[i] as f64, self.y[i] as f64);
                self.ctx.line_to(self.x[j] as f64, self.y[j] as f64);
                let _ = self.ctx.stroke();
            }
        }
    }
}

fn target_count(width: f64, quality: &str) -> usize {
    let n = (base_count(width) as f32 * quality_factor(quality)).round() as usize;
    n.clamp(6, 90)
}

/// Pre-render one small radial-gradient sprite per palette color, so the
/// hot loop is just `drawImage` calls — no gradient math per particle per
/// frame. Each sprite gets a bright specular core (rather than a flat
/// color center) so particles read as tiny sparkles instead of soft dots.
fn build_sprites(canvas: &HtmlCanvasElement) -> Result<Vec<HtmlCanvasElement>, JsValue> {
    let document = canvas
        .owner_document()
        .ok_or_else(|| JsValue::from_str("canvas has no owner document"))?;

    let size = (SPRITE_R * 2) as f64;
    let mut sprites = Vec::with_capacity(PALETTE.len());

    for color in PALETTE {
        let sprite = document
            .create_element("canvas")?
            .dyn_into::<HtmlCanvasElement>()?;
        sprite.set_width(SPRITE_R * 2);
        sprite.set_height(SPRITE_R * 2);

        let sctx = sprite
            .get_context("2d")?
            .ok_or_else(|| JsValue::from_str("2d context unavailable"))?
            .dyn_into::<CanvasRenderingContext2d>()?;

        let r = SPRITE_R as f64;
        let gradient = sctx.create_radial_gradient(r, r, 0.0, r, r, r)?;
        gradient.add_color_stop(0.0, "#ffffff")?;
        gradient.add_color_stop(0.18, color)?;
        gradient.add_color_stop(0.55, color)?;
        gradient.add_color_stop(1.0, "rgba(0,0,0,0)")?;

        sctx.set_fill_style_canvas_gradient(&gradient);
        sctx.fill_rect(0.0, 0.0, size, size);

        sprites.push(sprite);
    }

    Ok(sprites)
}
