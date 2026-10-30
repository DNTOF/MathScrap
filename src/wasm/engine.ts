import init, * as core from './pkg/mathcore.js'

export interface RustFact {
  group: string
  label: string
  value: string
  num: number | null
  how: string
  why: string
  shape: RustShape | null
}

export type RustShape =
  | { type: 'point'; x: number; y: number; label: string }
  | { type: 'point3'; x: number; y: number; z: number; label: string }
  | { type: 'circle'; cx: number; cy: number; r: number; label: string }
  | { type: 'segment'; x1: number; y1: number; x2: number; y2: number; label: string }
  | { type: 'line3'; px: number; py: number; pz: number; dx: number; dy: number; dz: number; label: string }
  | { type: 'arrow3'; x: number; y: number; z: number; label: string }

export interface TriangleCase {
  facts: RustFact[]
  vertices: [number, number][]
  note: string
}

export interface SolveResult {
  unknowns: string[]
  solutions: number[][]
  exact: boolean
  starts: number
  error: string | null
}

export type Env = Record<string, number>

const stats = { calls: 0, ms: 0 }
let ready: Promise<void> | null = null
let loaded = false

export function loadEngine(): Promise<void> {
  ready ??= init().then(() => {
    loaded = true
  })
  return ready
}

export const isEngineLoaded = () => loaded

export function resetStats() {
  stats.calls = 0
  stats.ms = 0
}

export function getStats() {
  return { ...stats }
}

function timed<T>(fn: () => T): T {
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    stats.calls += 1
    stats.ms += performance.now() - t0
  }
}

const envStr = (env?: Env) => (env && Object.keys(env).length ? JSON.stringify(env) : '')

function parseJson<T>(s: string, fallback: T): T {
  try {
    const v = JSON.parse(s)
    return (v ?? fallback) as T
  } catch {
    return fallback
  }
}

/** Typed facade over the Rust exports. Every call is timed for the "Rust/WASM" badge. */
export const engine = {
  version: () => core.version(),
  latex: (src: string) => timed(() => core.latex(src)),
  inspect: (src: string) =>
    timed(() => parseJson<{ ok: boolean; error: string | null; vars: string[]; source: string | null }>(core.inspect(src), { ok: false, error: '解析失败', vars: [], source: null })),
  substitute: (src: string, name: string, w: string) => timed(() => core.substitute(src, name, w)),
  eval: (src: string, env?: Env) => timed(() => core._eval(src, envStr(env))),
  sampleCurve: (src: string, v: string, env: Env | undefined, a: number, b: number, n: number) => timed(() => core.sample_curve(src, v, envStr(env), a, b, n)),
  sampleGrid: (src: string, xv: string, yv: string, env: Env | undefined, x0: number, x1: number, y0: number, y1: number, nx: number, ny: number) =>
    timed(() => core.sample_grid(src, xv, yv, envStr(env), x0, x1, y0, y1, nx, ny)),
  sampleVolume: (src: string, env: Env | undefined, lo: number, hi: number, n: number) => timed(() => core.sample_volume(src, envStr(env), lo, hi, n)),
  roots: (src: string, v: string, env: Env | undefined, a: number, b: number) => Array.from(timed(() => core.roots(src, v, envStr(env), a, b))),
  extrema: (src: string, v: string, env: Env | undefined, a: number, b: number) =>
    timed(() => parseJson<{ x: number; y: number; kind: 'max' | 'min' }[]>(core.extrema(src, v, envStr(env), a, b), [])),
  domainGaps: (src: string, v: string, env: Env | undefined, a: number, b: number) => Array.from(timed(() => core.domain_gaps(src, v, envStr(env), a, b))),
  intersectCurves: (f: string, g: string, env: Env | undefined, a: number, b: number) => Array.from(timed(() => core.intersect_curves(f, g, envStr(env), a, b))),
  intersectCurveImplicit: (f: string, F: string, env: Env | undefined, a: number, b: number) =>
    Array.from(timed(() => core.intersect_curve_implicit(f, F, envStr(env), a, b))),
  solveSystem: (eqs: string[], unknowns: string[], env?: Env) =>
    timed(() => parseJson<SolveResult>(core.solve_system(JSON.stringify(eqs), JSON.stringify(unknowns), envStr(env)), { unknowns, solutions: [], exact: false, starts: 0, error: '求解失败' })),
  linearCoeffs: (src: string, vars: string[], env?: Env) => timed(() => parseJson<number[] | null>(core.linear_coeffs(src, JSON.stringify(vars), envStr(env)), null)),
  conic: (src: string, env: Env | undefined, name: string) => timed(() => parseJson<RustFact[]>(core.conic_analyze(src, envStr(env), name), [])),
  triangle: (known: Record<string, number>) =>
    timed(() => parseJson<{ cases: TriangleCase[]; error: string | null }>(core.triangle_solve(JSON.stringify(known)), { cases: [], error: '求解失败' })),
  points: (pts: { name: string; p: number[] }[]) => timed(() => parseJson<RustFact[]>(core.points_analyze(JSON.stringify(pts)), [])),
  vectors: (vs: { name: string; v: number[] }[]) => timed(() => parseJson<RustFact[]>(core.vectors_analyze(JSON.stringify(vs)), [])),
  lines: (ls: { name: string; a: number; b: number; c: number }[], pts: { name: string; p: number[] }[]) =>
    timed(() => parseJson<RustFact[]>(core.lines_analyze(JSON.stringify(ls), JSON.stringify(pts)), [])),
  planes: (ps: { name: string; n: number[]; d: number }[], pts: { name: string; p: number[] }[]) =>
    timed(() => parseJson<RustFact[]>(core.planes_analyze(JSON.stringify(ps), JSON.stringify(pts)), [])),
  nice: (v: number) => timed(() => core.nice_number(v)),
}
