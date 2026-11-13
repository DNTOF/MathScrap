/**
 * Pen-position prediction for the live stroke — pure functions.
 *
 * Idea learned from studying established whiteboards (not their code): predict
 * only a very short horizon (~one frame up to 36 ms) from x/y/time alone, gate
 * the prediction off on sharp turns and jitter, and treat predicted points as
 * display-only — the next real sample replaces them and they never enter the
 * saved stroke.
 *
 * Two sources, in order of preference:
 *  1. `PointerEvent.getPredictedEvents()` (browser-native, Chromium).
 *  2. A tiny per-axis constant-velocity Kalman filter as fallback.
 */

export interface InkSample {
  /** screen px */
  x: number
  y: number
  /** ms, monotonic (event.timeStamp) */
  t: number
}

export type GateVerdict = 'sparse' | 'idle' | 'straight' | 'curve' | 'sharp' | 'jitter'

export interface GateResult {
  verdict: GateVerdict
  /** false → show no prediction at all */
  predict: boolean
  /** extrapolation budget this frame (0 when predict is false) */
  horizonMs: number
}

export interface GateOptions {
  minSamples?: number
  /** px/ms below which the pen counts as parked (jitter zone) */
  idleSpeedPxPerMs?: number
  /** single turn above this (deg) kills prediction */
  sharpTurnDeg?: number
  /** oscillating turns above this (deg) count as jitter */
  jitterTurnDeg?: number
  /** mean turn above this (deg) shortens the horizon */
  curveTurnDeg?: number
  straightHorizonMs?: number
  curveHorizonMs?: number
}

export const DEFAULT_GATE_OPTIONS: Required<GateOptions> = {
  minSamples: 2,
  idleSpeedPxPerMs: 0.04,
  sharpTurnDeg: 65,
  jitterTurnDeg: 30,
  curveTurnDeg: 12,
  straightHorizonMs: 33,
  curveHorizonMs: 17,
}

export const PREDICTION_MAX_HORIZON_MS = 36
export const PREDICTION_STEP_MS = 11

/** Gating and the KF only need the recent gesture — cap the sample history so a long stroke costs the same as a short one. */
export const PREDICTION_HISTORY_CAP = 96

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/**
 * Decide whether the current stroke moment may be extrapolated, and by how much.
 * Pure; never mutates `samples`.
 */
export function gateSamples(samples: InkSample[], o: GateOptions = {}): GateResult {
  const opt = { ...DEFAULT_GATE_OPTIONS, ...o }
  const none: GateResult = { verdict: 'sparse', predict: false, horizonMs: 0 }
  if (samples.length < opt.minSamples) return none

  const vx: number[] = []
  const vy: number[] = []
  const speeds: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t
    if (dt <= 0) continue
    const dx = samples[i].x - samples[i - 1].x
    const dy = samples[i].y - samples[i - 1].y
    vx.push(dx / dt)
    vy.push(dy / dt)
    speeds.push(Math.hypot(dx, dy) / dt)
  }
  if (!speeds.length) return none
  if (speeds[speeds.length - 1] < opt.idleSpeedPxPerMs) return { verdict: 'idle', predict: false, horizonMs: 0 }

  // signed turn angles (deg) between successive velocity vectors
  const turns: number[] = []
  for (let i = 1; i < vx.length; i++) {
    const a = Math.hypot(vx[i - 1], vy[i - 1])
    const b = Math.hypot(vx[i], vy[i])
    if (a < 1e-9 || b < 1e-9) continue
    const cos = clamp((vx[i - 1] * vx[i] + vy[i - 1] * vy[i]) / (a * b), -1, 1)
    const cross = vx[i - 1] * vy[i] - vy[i - 1] * vx[i]
    turns.push((cross < 0 ? -1 : 1) * Math.acos(cos) * (180 / Math.PI))
  }
  const maxTurn = turns.length ? Math.max(...turns.map(Math.abs)) : 0
  if (maxTurn > opt.sharpTurnDeg) return { verdict: 'sharp', predict: false, horizonMs: 0 }

  // jitter: large zig-zag (two consecutive opposite-sign turns) or sustained
  // recent oscillation. Flips only count in the last ~12 pairs and need BOTH
  // turns above jitterTurnDeg/2 — pointer noise produces small random turns
  // whose flips accumulate harmlessly over a long window (replay-eval finding).
  const flipDeg = opt.jitterTurnDeg / 2
  const recent = turns.slice(-12)
  let flips = 0
  for (let i = 1; i < recent.length; i++) {
    if (Math.abs(recent[i]) > opt.jitterTurnDeg && Math.abs(recent[i - 1]) > opt.jitterTurnDeg && recent[i] * recent[i - 1] < 0)
      return { verdict: 'jitter', predict: false, horizonMs: 0 }
    if (Math.abs(recent[i]) >= flipDeg && Math.abs(recent[i - 1]) >= flipDeg && recent[i] * recent[i - 1] < 0) flips++
  }
  if (flips >= 3) return { verdict: 'jitter', predict: false, horizonMs: 0 }

  // curve vs straight on a ROBUST statistic: the median turn, not the max —
  // a noisy window always contains one large random turn, so a max-based test
  // read every straight stroke as a curve (replay-eval finding)
  const abs = turns.map(Math.abs).sort((a, b) => a - b)
  const medianTurn = abs.length ? abs[abs.length >> 1] : 0
  if (medianTurn > opt.curveTurnDeg) return { verdict: 'curve', predict: true, horizonMs: opt.curveHorizonMs }
  return { verdict: 'straight', predict: true, horizonMs: opt.straightHorizonMs }
}

/** Minimal per-axis constant-velocity Kalman filter (state [p, v], measurement [p]). */
export interface KF1D {
  p: number
  /** px/s */
  v: number
  p00: number
  p01: number
  p10: number
  p11: number
}

/** Spectral density of the acceleration noise, px²/s⁴ — tuned for handwriting snaps. */
export const KF_ACCEL_VAR = 9e6
/** Pointer measurement variance, px². */
export const KF_MEAS_VAR = 2

export function kfInit(pos: number): KF1D {
  // generous velocity prior so the filter adopts real speed within a few samples
  return { p: pos, v: 0, p00: 40, p01: 0, p10: 0, p11: 1e5 }
}

export function kfPredict(s: KF1D, dtMs: number, accelVar = KF_ACCEL_VAR): KF1D {
  const dt = dtMs / 1000
  const q = accelVar
  return {
    p: s.p + s.v * dt,
    v: s.v,
    p00: s.p00 + 2 * dt * s.p01 + dt * dt * s.p11 + (q * dt ** 4) / 4,
    p01: s.p01 + dt * s.p11 + (q * dt ** 3) / 2,
    p10: s.p10 + dt * s.p11 + (q * dt ** 3) / 2,
    p11: s.p11 + q * dt * dt,
  }
}

export function kfUpdate(s: KF1D, z: number, measVar = KF_MEAS_VAR): KF1D {
  const y = z - s.p
  const k0 = s.p00 / (s.p00 + measVar)
  const k1 = s.p10 / (s.p00 + measVar)
  return {
    p: s.p + k0 * y,
    v: s.v + k1 * y,
    p00: (1 - k0) * s.p00,
    p01: (1 - k0) * s.p01,
    p10: s.p10 - k1 * s.p00,
    p11: s.p11 - k1 * s.p01,
  }
}

export interface PredictOptions {
  /** extrapolation budget, capped at PREDICTION_MAX_HORIZON_MS */
  horizonMs?: number
  stepMs?: number
  /** KF acceleration noise override (default KF_ACCEL_VAR) — replay-eval knob, defaults unchanged */
  qAcc?: number
  /** KF measurement variance override (default KF_MEAS_VAR) — replay-eval knob, defaults unchanged */
  measVar?: number
}

/**
 * Fallback predictor: run the per-axis KF over the recent real samples, then
 * step forward `horizonMs`. Pure — the input samples are never mutated, the
 * result is a fresh array of display-only points beyond the last real sample.
 */
export function predictTail(samples: InkSample[], o: PredictOptions = {}): InkSample[] {
  const horizonMs = Math.min(o.horizonMs ?? DEFAULT_GATE_OPTIONS.straightHorizonMs, PREDICTION_MAX_HORIZON_MS)
  const stepMs = o.stepMs ?? PREDICTION_STEP_MS
  const n = samples.length
  if (n < 2) return []
  if (!(samples[n - 1].t > samples[0].t)) return []

  let kx = kfInit(samples[0].x)
  let ky = kfInit(samples[0].y)
  let t = samples[0].t
  for (let i = 1; i < n; i++) {
    const dt = samples[i].t - t
    if (dt <= 0) continue // non-monotonic guard: keep the filter on the last good time
    kx = kfUpdate(kfPredict(kx, dt, o.qAcc), samples[i].x, o.measVar)
    ky = kfUpdate(kfPredict(ky, dt, o.qAcc), samples[i].y, o.measVar)
    t = samples[i].t
  }
  const out: InkSample[] = []
  for (let d = stepMs; d <= horizonMs + 1e-9; d += stepMs) {
    out.push({ x: kfPredict(kx, d).p, y: kfPredict(ky, d).p, t: t + d })
  }
  return out
}

export interface PredictedEventLike {
  clientX: number
  clientY: number
}

export type PredictedProvider = {
  getPredictedEvents?: () => PredictedEventLike[]
}

/**
 * Native predicted events when the platform offers them (Chromium), else [].
 * Coordinates stay in screen space; count is capped — the tail is a hint, not a
 * path to commit.
 */
export function nativePredictedTail(e: PredictedProvider, maxPoints = 4): PredictedEventLike[] {
  const fn = e.getPredictedEvents
  if (typeof fn !== 'function') return []
  let evs: PredictedEventLike[]
  try {
    evs = fn.call(e)
  } catch {
    return []
  }
  if (!Array.isArray(evs) || !evs.length) return []
  return evs.slice(0, maxPoints).map((ev) => ({ clientX: ev.clientX, clientY: ev.clientY }))
}

// --- refresh-rate adaptive step/horizon -------------------------------------

export const ADAPTIVE_MIN_FRAME_MS = 4
export const ADAPTIVE_MAX_FRAME_MS = 33
/** fall back to a 60 Hz assumption until rAF deltas come in */
export const ADAPTIVE_DEFAULT_FRAME_MS = 16.7
export const ADAPTIVE_MIN_STEP_MS = 3
export const ADAPTIVE_MAX_STEP_MS = PREDICTION_STEP_MS // never coarser than the static 11 ms
/** how many frames of lag the tail aims to cover */
export const ADAPTIVE_FRAMES_AHEAD = 2
/** curve verdicts get this fraction of the straight-line horizon */
export const ADAPTIVE_CURVE_FRACTION = 0.5

export interface AdaptiveOptions {
  /** how many frames of lag the tail aims to cover (replay-eval knob, default ADAPTIVE_FRAMES_AHEAD) */
  framesAhead?: number
  /** curve verdicts get this fraction of the straight-line horizon (default ADAPTIVE_CURVE_FRACTION) */
  curveFraction?: number
}

export interface AdaptivePrediction {
  stepMs: number
  horizonMs: number
  curveHorizonMs: number
}

/**
 * Scale the prediction step and horizon to the display's frame interval
 * (estimated from rAF deltas): a 120 Hz panel gets a finer, shorter tail than a
 * 60 Hz one, both under the absolute PREDICTION_MAX_HORIZON_MS cap. Degenerate
 * intervals (first frame, background tab) clamp into a sane range.
 */
export function frameAdaptivePrediction(frameIntervalMs: number, o: AdaptiveOptions = {}): AdaptivePrediction {
  const ahead = o.framesAhead ?? ADAPTIVE_FRAMES_AHEAD
  const curveFraction = o.curveFraction ?? ADAPTIVE_CURVE_FRACTION
  const f =
    Number.isFinite(frameIntervalMs) && frameIntervalMs > 0
      ? Math.min(ADAPTIVE_MAX_FRAME_MS, Math.max(ADAPTIVE_MIN_FRAME_MS, frameIntervalMs))
      : ADAPTIVE_DEFAULT_FRAME_MS
  const stepMs = Math.min(ADAPTIVE_MAX_STEP_MS, Math.max(ADAPTIVE_MIN_STEP_MS, f / 2))
  const horizonMs = Math.min(PREDICTION_MAX_HORIZON_MS, Math.max(stepMs, f * ahead))
  const curveHorizonMs = Math.max(stepMs, horizonMs * curveFraction)
  return { stepMs, horizonMs, curveHorizonMs }
}

/**
 * Display-only ghost path for the separately-rendered prediction tail: starts at
 * the stroke tip (last smoothed point) and runs through the predicted points.
 * Pure — neither input is mutated, and nothing here ever reaches saved data.
 */
export function predictionTailPath(basePts: number[], tail: number[]): number[] {
  const n = basePts.length
  if (n < 3) return tail.slice()
  return [basePts[n - 3], basePts[n - 2], basePts[n - 1], ...tail]
}
