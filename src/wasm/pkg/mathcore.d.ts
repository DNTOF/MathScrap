/* tslint:disable */
/* eslint-disable */

/**
 * Evaluate with all variables taken from `env`.
 */
export function _eval(src: string, env: string): number;

/**
 * `{"cx":..,"cy":..,"r":..}` when the implicit curve F(x, y) = 0 is a real circle, else "null".
 */
export function circle_of(src: string, env: string): string;

/**
 * Solve a circle chord problem around one point P:
 * `{"r":5,"cross":{"p":"P","chords":[["A","B"],["C","D"]],"lengths":{"PA":2,"PB":6,"PC":4},"pos":"in"}}`
 * → cases with the derived segment, chord lengths, centre distances, central angles.
 */
export function circle_solve(known_json: string): string;

/**
 * [{"name":"O","cx":0,"cy":0,"r":5}] plus named points → facts about powers, chords,
 * central / inscribed angles, chord crossings.
 */
export function circles_analyze(circles_json: string, points_json: string): string;

/**
 * Classify a quadratic implicit curve F(x, y) = 0 (circle / ellipse / hyperbola / parabola).
 */
export function conic_analyze(src: string, env: string, name: string): string;

/**
 * Pairs [start, end, ...] of intervals in [a, b] where the expression is undefined.
 */
export function domain_gaps(src: string, _var: string, env: string, a: number, b: number): Float64Array;

export function extrema(src: string, _var: string, env: string, a: number, b: number): string;

/**
 * Validate an expression and list its free variables.
 */
export function inspect(src: string): string;

/**
 * Intersections of y = f(x) with the implicit curve F(x, y) = 0.
 */
export function intersect_curve_implicit(f: string, big_f: string, env: string, a: number, b: number): Float64Array;

/**
 * Intersections of y = f(x) and y = g(x) on [a, b] as [x0, y0, x1, y1, ...].
 */
export function intersect_curves(f: string, g: string, env: string, a: number, b: number): Float64Array;

/**
 * LaTeX for a statement (`y = x^2`, `a = (1, 2)`, `sin(x)/x`).
 */
export function latex(src: string): string;

/**
 * Coefficients if `src` is affine in `vars`: [c_0, ..., c_{n-1}, constant]; `null` otherwise.
 */
export function linear_coeffs(src: string, vars_json: string, env: string): string;

/**
 * [{"name":"l_1","a":2,"b":-1,"c":-1}] meaning a x + b y = c, plus points for distances.
 */
export function lines_analyze(lines_json: string, points_json: string): string;

/**
 * Number formatting shared with the UI: exact forms (√, fractions, π) plus decimals.
 */
export function nice_number(v: number): string;

/**
 * [{"name":"π_1","n":[1,1,1],"d":3}] meaning n · (x, y, z) = d, plus points for distances.
 */
export function planes_analyze(planes_json: string, points_json: string): string;

/**
 * [{"name":"A","p":[0,0]}, ...] → facts about distances, polygon, triangle centres.
 */
export function points_analyze(points_json: string): string;

export function roots(src: string, _var: string, env: string, a: number, b: number): Float64Array;

/**
 * Sample `src` over `var ∈ [a, b]` at `n` points.
 */
export function sample_curve(src: string, _var: string, env: string, a: number, b: number, n: number): Float64Array;

/**
 * Row-major grid: out[j * nx + i] = f(x_i, y_j).
 */
export function sample_grid(src: string, xv: string, yv: string, env: string, x0: number, x1: number, y0: number, y1: number, nx: number, ny: number): Float64Array;

/**
 * Volume samples for isosurfaces: index = (k * n + j) * n + i over x_i, y_j, z_k in [lo, hi]³.
 */
export function sample_volume(src: string, env: string, lo: number, hi: number, n: number): Float64Array;

/**
 * Solve residual equations `eqs` (each = 0) for `unknowns` with multi-start Levenberg–Marquardt.
 * `eqs_json`: ["k*1 + b - 3", ...], `unknowns_json`: ["k", "b"].
 */
export function solve_system(eqs_json: string, unknowns_json: string, env: string): string;

/**
 * Replace variable `name` with expression `with` and return normalised source.
 */
export function substitute(src: string, name: string, _with: string): string;

/**
 * Solve a triangle from partial data: {"a":3,"b":4,"C":1.5708,"S":6} (angles in radians).
 */
export function triangle_solve(known_json: string): string;

/**
 * [{"name":"a","v":[1,2,3]}, ...]
 */
export function vectors_analyze(vectors_json: string): string;

export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly _eval: (a: number, b: number, c: number, d: number) => number;
    readonly circle_of: (a: number, b: number, c: number, d: number) => [number, number];
    readonly circle_solve: (a: number, b: number) => [number, number];
    readonly circles_analyze: (a: number, b: number, c: number, d: number) => [number, number];
    readonly conic_analyze: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly domain_gaps: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly extrema: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly inspect: (a: number, b: number) => [number, number];
    readonly intersect_curve_implicit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly intersect_curves: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly latex: (a: number, b: number) => [number, number];
    readonly linear_coeffs: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly lines_analyze: (a: number, b: number, c: number, d: number) => [number, number];
    readonly nice_number: (a: number) => [number, number];
    readonly planes_analyze: (a: number, b: number, c: number, d: number) => [number, number];
    readonly points_analyze: (a: number, b: number) => [number, number];
    readonly roots: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly sample_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly sample_grid: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly sample_volume: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly solve_system: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly substitute: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly triangle_solve: (a: number, b: number) => [number, number];
    readonly vectors_analyze: (a: number, b: number) => [number, number];
    readonly version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
