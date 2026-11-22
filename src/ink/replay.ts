/**
 * Offline replay evaluation for the ink-prediction experiment — pure Node, no DOM.
 *
 * SYNTHETIC, reproducible handwriting-like trajectories are replayed sample by
 * sample through the exact gate + Kalman pipeline the Board uses; every
 * predicted tail end is compared against the trajectory's exact (noise-free)
 * ground truth at the tail's own timestamp.
 *
 * The numbers are STARTING-POINT CANDIDATES for on-device (iPad) tuning only —
 * nothing here changes any default, and synthetic noise is not real ink.
 */
import { frameAdaptivePrediction, gateSamples, PREDICTION_HISTORY_CAP, predictTail, type GateOptions, type InkSample } from './predict'

/** tiny deterministic PRNG (mulberry32) so every replay run is reproducible */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type TrajectoryScenario = 'straight' | 'fastArc' | 'sharpTurn' | 'jitter' | 'pause' | 'slowTick'

export const SCENARIO_LABELS: Record<TrajectoryScenario, string> = {
  straight: 'straight line',
  fastArc: 'fast arc (small radius)',
  sharpTurn: 'sharp turn',
  jitter: 'jitter',
  pause: 'pause',
  slowTick: 'slow short tick',
}

const SCENARIO_DURATION_MS: Record<TrajectoryScenario, number> = {
  straight: 1500,
  fastArc: 600,
  sharpTurn: 1000,
  jitter: 800,
  pause: 1300,
  slowTick: 500,
}

export interface ReplayTrajectory {
  scenario: TrajectoryScenario
  samples: InkSample[]
  /** exact, noise-free position at time t (ms) */
  truthAt: (t: number) => { x: number; y: number }
}

export interface TrajectoryOptions {
  rateHz?: number
  noisePx?: number
  seed?: number
}

/**
 * Build one synthetic trajectory. Ground truth stays parametric and exact;
 * Gaussian noise is added to the samples only, like pointer-reporting jitter.
 */
export function makeTrajectory(scenario: TrajectoryScenario, o: TrajectoryOptions = {}): ReplayTrajectory {
  const rateHz = o.rateHz ?? 60
  const noisePx = o.noisePx ?? 0.6
  const rnd = mulberry32(o.seed ?? 42)
  const gauss = () => {
    const u = Math.max(rnd(), 1e-9)
    const v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const dt = 1000 / rateHz
  const duration = SCENARIO_DURATION_MS[scenario]

  let truthAt: (t: number) => { x: number; y: number }
  switch (scenario) {
    case 'straight':
      // 600 px/s to the right for 1.5 s
      truthAt = (t) => ({ x: 120 + 0.6 * t, y: 200 })
      break
    case 'fastArc':
      // tight fast arc (like the loop of a handwritten "e"): r=25, v=600 px/s
      truthAt = (t) => {
        const theta = (600 / 25) * (t / 1000)
        return { x: 300 + 25 * Math.cos(theta), y: 240 + 25 * Math.sin(theta) }
      }
      break
    case 'sharpTurn':
      // 600 ms straight, then a hard 90° turn downwards
      truthAt = (t) => (t < 600 ? { x: 120 + 0.6 * t, y: 200 } : { x: 480, y: 200 + 0.6 * (t - 600) })
      break
    case 'jitter':
      // horizontal drag under a fast triangular wobble (alternating ~60° turns)
      truthAt = (t) => {
        const phase = (t % 80) / 80
        return { x: 120 + 0.5 * t, y: 200 + 6 * (phase < 0.5 ? phase * 2 : 2 - phase * 2) }
      }
      break
    case 'pause':
      // write, hold still for 300 ms (device keeps reporting), write again
      truthAt = (t) => {
        if (t < 500) return { x: 120 + 0.6 * t, y: 200 }
        if (t < 800) return { x: 420, y: 200 }
        return { x: 420 + 0.6 * (t - 800), y: 200 }
      }
      break
    case 'slowTick':
      // a slow deliberate short tick: ~6 px over 500 ms (idle-speed territory)
      truthAt = (t) => ({ x: 100 + 0.012 * t, y: 300 + 0.0024 * t })
      break
  }

  const n = Math.round((duration * rateHz) / 1000) + 1
  const samples: InkSample[] = []
  for (let i = 0; i < n; i++) {
    const t = i * dt
    const p = truthAt(t)
    samples.push({ x: p.x + gauss() * noisePx, y: p.y + gauss() * noisePx, t })
  }
  return { scenario, samples, truthAt }
}

export interface ReplayCandidate {
  name: string
  /** gate angle/horizon overrides (defaults = current constants) */
  gate?: GateOptions
  /** KF acceleration-noise override (default KF_ACCEL_VAR) */
  qAcc?: number
  /** KF measurement-variance override (default KF_MEAS_VAR) */
  measVar?: number
  /** frames of lag the tail covers (default ADAPTIVE_FRAMES_AHEAD) */
  framesAhead?: number
}

export interface ReplayStats {
  candidate: string
  scenario: TrajectoryScenario
  rateHz: number
  /** evaluated moments (one per sample with enough history) */
  moments: number
  /** moments where the gate allowed a prediction */
  predicted: number
  /** moments where the gate suppressed the tail */
  gated: number
  /** |predicted tail end − ground truth| at the tail's own timestamp (px) */
  meanErr: number
  p95Err: number
  maxErr: number
  /** signed overshoot: error component along the travel direction, + = ahead of the true point (px) */
  meanOvershoot: number
}

const MIN_HISTORY = 8

/** Replay one trajectory under one candidate constant set. Pure w.r.t. inputs. */
export function replayTrajectory(traj: ReplayTrajectory, cand: ReplayCandidate, rateHz: number): ReplayStats {
  const frameMs = 1000 / rateHz
  const adapt = frameAdaptivePrediction(frameMs, { framesAhead: cand.framesAhead })
  const errs: number[] = []
  const overshoots: number[] = []
  let predicted = 0
  let gated = 0
  const samples = traj.samples
  for (let i = MIN_HISTORY; i < samples.length; i++) {
    const hist = samples.slice(Math.max(0, i - PREDICTION_HISTORY_CAP + 1), i + 1)
    const gate = gateSamples(hist, cand.gate)
    const last = hist[hist.length - 1]
    if (!gate.predict) {
      gated++
      continue
    }
    const horizon = gate.verdict === 'curve' ? adapt.curveHorizonMs : adapt.horizonMs
    const tail = predictTail(hist, { horizonMs: horizon, stepMs: adapt.stepMs, qAcc: cand.qAcc, measVar: cand.measVar })
    if (!tail.length) {
      gated++
      continue
    }
    predicted++
    const end = tail[tail.length - 1]
    const truth = traj.truthAt(end.t)
    errs.push(Math.hypot(end.x - truth.x, end.y - truth.y))
    // overshoot = error component along the current travel direction (+ = past the true point)
    const prev = hist[hist.length - 2]
    const dx = last.x - prev.x
    const dy = last.y - prev.y
    const len = Math.max(Math.hypot(dx, dy), 1e-6)
    overshoots.push(((end.x - truth.x) * dx + (end.y - truth.y) * dy) / len)
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const sorted = [...errs].sort((a, b) => a - b)
  return {
    candidate: cand.name,
    scenario: traj.scenario,
    rateHz,
    moments: predicted + gated,
    predicted,
    gated,
    meanErr: mean(errs),
    p95Err: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
    maxErr: sorted.length ? sorted[sorted.length - 1] : 0,
    meanOvershoot: mean(overshoots),
  }
}
