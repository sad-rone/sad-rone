# pờ rô pai sát ron

Cyberpunk-terminal-style personal profile page. Static frontend with two
effect modules offloaded to WASM (Rust + C++), a Canvas 2D + CSS-animation
frontend layer (no Three.js/WebGL), and a small Go backend for the view
counter.

## sờ tách

- **Frontend**: vanilla HTML/CSS/JS + TypeScript (`perf.ts`, `perf-widget.tsx`)
- **Particle system**: Rust → WASM (`lib.rs`, `Cargo.toml`)
- **Matrix rain / image glitch effects**: C++ → WASM via Emscripten (`cpp-fx/effects.cpp`)
- **View counter API**: Go (`main.go`)

## Bui

`pkg-cpp/` (C++ → WASM, powers matrix rain + image glitch) is checked
into the repo as a prebuilt snapshot, so those two effects work without
any build step. `pkg/` (Rust → WASM, powers the particle system) is
**not** checked in yet and must be built locally — the particle
background won't render until you do:

**Rust particle system → `pkg/`**
```bash
cargo install wasm-pack   # once
wasm-pack build --target web --out-dir pkg
```

**Rebuilding C++ effects → `pkg-cpp/`** (only needed if you edit `effects.cpp`;
requires the Emscripten SDK on PATH)
```bash
cd cpp-fx
./build_cpp.sh
```
Commit the regenerated `pkg-cpp/effects.js` + `effects.wasm` afterward.

**TypeScript → `perf.js` / `perf-widget.js`**
```bash
npm install
npm run build
```

**Go view-counter backend**
```bash
go run main.go
```

## Run locally

After building the WASM modules, serve the repo root with any static
file server (module imports require `http://`, not `file://`):
```bash
npx serve .
```
