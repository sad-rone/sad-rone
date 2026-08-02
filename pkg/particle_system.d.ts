/* tslint:disable */
/* eslint-disable */

export class ParticleSystem {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Clear the canvas. Call before dropping the system (e.g. quality
     * collapsed to "minimal" mid-session and JS is tearing this down).
     */
    destroy(): void;
    /**
     * Create and mount a particle system on the given canvas element.
     *
     * `seed` should just be `Date.now() >>> 0` from the JS side — it only
     * needs to differ run to run, it isn't cryptographic.
     */
    constructor(canvas: HTMLCanvasElement, width: number, height: number, quality: string, seed: number);
    particle_count(): number;
    /**
     * Call on window resize (debounced on the JS side — no need to call
     * this on every `resize` event, once every ~200ms is plenty).
     */
    resize(width: number, height: number): void;
    /**
     * Call when `perfMgr.onChange` fires. Cheap: only touches particle
     * count and whether constellation links are drawn.
     */
    set_quality(quality: string): void;
    /**
     * Advance the simulation and paint one frame. `timestamp_ms` should be
     * the value handed to you by `requestAnimationFrame`.
     */
    step(timestamp_ms: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_particlesystem_free: (a: number, b: number) => void;
    readonly particlesystem_destroy: (a: number) => void;
    readonly particlesystem_new: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly particlesystem_particle_count: (a: number) => number;
    readonly particlesystem_resize: (a: number, b: number, c: number) => void;
    readonly particlesystem_set_quality: (a: number, b: number, c: number) => void;
    readonly particlesystem_step: (a: number, b: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
