/// <reference types="vite/client" />

declare module 'virtual:svg-icons-register';

/** Static wasm-bindgen glue served from public/rcb-wasm (see build-wasm.mjs). */
declare module '/rcb-wasm/rcb_wasm_geom.js' {
  export default function init(opts?: {
    module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
  }): Promise<unknown>;
  export function densify_path_d(d: string, flatness: number): Float32Array;
  export function tessellate_fill(xy: Float32Array): Float32Array;
  export function tessellate_fill_with_holes(
    outer: Float32Array,
    holesFlat: Float32Array,
    holeCounts: Uint32Array
  ): Float32Array;
  export function tessellate_stroke(
    xy: Float32Array,
    width: number,
    closed: boolean,
    align: string,
    linejoin?: string,
    miterLimit?: number
  ): Float32Array;
  export function tessellate_batch_fill(xyAll: Float32Array, counts: Uint32Array): Float32Array;
  export function boolean_polygons(op: number, packed: Float32Array): Float32Array;
  export function offset_polyline(
    xy: Float32Array,
    width: number,
    closed: boolean,
    join: number,
    cap: number,
    miterLimit: number,
    roundApprox: number
  ): Float32Array;
  export function simplify_rdp(xy: Float32Array, epsilon: number): Float32Array;
  export function simplify_rdp_closed(xy: Float32Array, epsilon: number): Float32Array;
  export function trace_rgba_contours(
    rgba: Uint8Array,
    width: number,
    height: number,
    alphaThreshold: number
  ): Float32Array;
}

declare const __GOOGLE_CLIENT_ID__: string;
declare const __DOCS_URL__: string;
declare const __DESKTOP_MODE__: string;
declare const __API_BASE_URL__: string;

interface ImportMetaEnv {
  readonly VITE_DESKTOP_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DOCS_URL?: string;
  readonly VITE_COLLAB_ENABLED?: string;
  readonly TAURI_ENV_PLATFORM?: string;
}
