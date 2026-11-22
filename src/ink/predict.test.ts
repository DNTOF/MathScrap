/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ADAPTIVE_MAX_STEP_MS,
  ADAPTIVE_MIN_STEP_MS,
  DEFAULT_GATE_OPTIONS,
  frameAdaptivePrediction,
  gateSamples,
  kfInit,
  kfPredict,
  kfUpdate,
  nativePredictedTail,
  predictionTailPath,
  predictTail,
  PREDICTION_MAX_HORIZON_MS,
  type InkSample,
} from './predict'

/** straight drag to the right at constant speed */
const straight = (n = 8, dt = 8, speed = 0.6): InkSample[] =>
  Array.from({ length: n }, (_, i) => ({ x: 100 + i * speed * dt, y: 200, t: 1000 + i * dt }))

test('gate: steady straight stroke predicts with the full horizon', () => {
  const g = gateSamples(straight())
  assert.equal(g.verdict, 'straight')
  assert.equal(g.predict, true)
  assert.equal(g.horizonMs, DEFAULT_GATE_OPTIONS.straightHorizonMs)
})

test('gate: gentle curve predicts with a shorter horizon', () => {
  // heading rotates ~15° per step at constant speed (above curveTurnDeg=12, well below sharp=65)
  const samples: InkSample[] = []
  let x = 0
  let y = 0
  let heading = 0
  for (let i = 0; i < 8; i++) {
    samples.push({ x, y, t: 1000 + i * 8 })
    heading += (15 * Math.PI) / 180
    x += Math.cos(heading) * 4.8
    y += Math.sin(heading) * 4.8
  }
  const g = gateSamples(samples)
  assert.equal(g.verdict, 'curve')
  assert.equal(g.predict, true)
  assert.equal(g.horizonMs, DEFAULT_GATE_OPTIONS.curveHorizonMs)
  assert.ok(g.horizonMs < DEFAULT_GATE_OPTIONS.straightHorizonMs)
})

test('gate: sharp turn disables prediction', () => {
  const samples: InkSample[] = []
  for (let i = 0; i < 6; i++) samples.push({ x: i * 5, y: 0, t: 1000 + i * 8 })
  for (let i = 0; i < 3; i++) samples.push({ x: 25, y: i * 5, t: 1024 + i * 8 }) // hard 90° turn
  const g = gateSamples(samples)
  assert.equal(g.verdict, 'sharp')
  assert.equal(g.predict, false)
  assert.equal(g.horizonMs, 0)
})

test('gate: jitter (zig-zag waveform) disables prediction', () => {
  // gentle zig-zag: ~53° alternating turns → not a single "sharp" turn, but oscillation
  const samples: InkSample[] = []
  for (let i = 0; i < 10; i++) samples.push({ x: i * 4, y: i % 2 === 0 ? 0 : 2, t: 1000 + i * 8 })
  const g = gateSamples(samples)
  assert.equal(g.verdict, 'jitter')
  assert.equal(g.predict, false)
})

test('gate: parked pen (idle) and too-few samples do not predict', () => {
  assert.equal(gateSamples([{ x: 1, y: 2, t: 0 }, { x: 1.001, y: 2, t: 8 }]).verdict, 'idle')
  assert.equal(gateSamples([{ x: 1, y: 2, t: 0 }]).verdict, 'sparse')
  assert.equal(gateSamples([]).verdict, 'sparse')
  const idle = gateSamples([{ x: 1, y: 2, t: 0 }, { x: 1.001, y: 2, t: 8 }])
  assert.equal(idle.predict, false)
})

test('gate: pure — input samples are never mutated', () => {
  const frozen = Object.freeze(straight().map(Object.freeze)) as readonly InkSample[]
  assert.doesNotThrow(() => gateSamples(frozen as InkSample[]))
})

test('predictTail: constant velocity is extrapolated within tolerance', () => {
  const samples = straight(20, 8, 0.6) // 0.6 px/ms ≈ 600 px/s
  const tail = predictTail(samples, { horizonMs: 33, stepMs: 11 })
  assert.equal(tail.length, 3)
  const last = samples[samples.length - 1]
  const expected = last.x + 0.6 * 33
  assert.ok(Math.abs(tail[2].x - expected) / expected < 0.15, `got ${tail[2].x}, want ≈ ${expected}`)
  // y barely moves → prediction stays put
  assert.ok(Math.abs(tail[2].y - last.y) < 3)
  assert.equal(tail[2].t, last.t + 33)
})

test('predictTail: horizon is capped at 36 ms and input stays untouched', () => {
  const samples = straight()
  const snapshot = JSON.stringify(samples)
  const tail = predictTail(samples, { horizonMs: 500, stepMs: 11 })
  assert.ok(tail.length > 0)
  const last = samples[samples.length - 1]
  assert.ok(tail[tail.length - 1].t - last.t <= PREDICTION_MAX_HORIZON_MS + 1e-9)
  assert.equal(JSON.stringify(samples), snapshot)
})

test('predictTail: degenerate inputs return an empty tail', () => {
  assert.deepEqual(predictTail([]), [])
  assert.deepEqual(predictTail([{ x: 1, y: 1, t: 5 }]), [])
  assert.deepEqual(predictTail([{ x: 1, y: 1, t: 5 }, { x: 2, y: 1, t: 5 }]), []) // no time span
})

test('KF converges on constant velocity input', () => {
  let k = kfInit(0)
  for (let i = 1; i <= 20; i++) k = kfUpdate(kfPredict(k, 8), i * 0.6 * 8)
  assert.ok(Math.abs(k.v - 600) / 600 < 0.1, `velocity estimate ${k.v}`)
})

test('nativePredictedTail: prefers the browser, falls back cleanly', () => {
  const provider = {
    getPredictedEvents: () => [
      { clientX: 1, clientY: 2, pressure: 0.5 },
      { clientX: 3, clientY: 4, pressure: 0.5 },
    ],
  }
  const tail = nativePredictedTail(provider)
  assert.deepEqual(tail, [{ clientX: 1, clientY: 2 }, { clientX: 3, clientY: 4 }])
  // missing API → empty (caller uses the self-extrapolation fallback)
  assert.deepEqual(nativePredictedTail({}), [])
  assert.deepEqual(nativePredictedTail({ getPredictedEvents: () => [] }), [])
  // throws → empty
  assert.deepEqual(
    nativePredictedTail({
      getPredictedEvents: () => {
        throw new Error('boom')
      },
    }),
    [],
  )
  // capped
  const many = nativePredictedTail({
    getPredictedEvents: () => Array.from({ length: 9 }, (_, i) => ({ clientX: i, clientY: i })),
  })
  assert.equal(many.length, 4)
})

test('frameAdaptivePrediction: scales with the refresh rate, caps preserved', () => {
  const a60 = frameAdaptivePrediction(16.7)
  const a120 = frameAdaptivePrediction(8.3)
  const a144 = frameAdaptivePrediction(6.9)
  // ~2 frames ahead on a straight verdict, half of that on curves
  assert.ok(Math.abs(a60.horizonMs - 33.4) < 0.01)
  assert.ok(Math.abs(a60.stepMs - 8.35) < 0.01)
  assert.ok(Math.abs(a60.curveHorizonMs - a60.horizonMs / 2) < 0.01)
  // higher refresh → finer step and shorter tail
  assert.ok(a120.stepMs < a60.stepMs)
  assert.ok(a120.horizonMs < a60.horizonMs)
  assert.ok(a144.stepMs < a120.stepMs)
  assert.ok(a144.horizonMs < a120.horizonMs)
  for (const a of [a60, a120, a144]) {
    assert.ok(a.horizonMs <= PREDICTION_MAX_HORIZON_MS + 1e-9, 'absolute horizon cap')
    assert.ok(a.stepMs >= ADAPTIVE_MIN_STEP_MS && a.stepMs <= ADAPTIVE_MAX_STEP_MS)
    assert.ok(a.curveHorizonMs <= a.horizonMs + 1e-9)
  }
})

test('frameAdaptivePrediction: degenerate intervals clamp into range', () => {
  for (const f of [0, -5, NaN, Infinity, 500]) {
    const a = frameAdaptivePrediction(f)
    assert.ok(a.stepMs >= ADAPTIVE_MIN_STEP_MS && a.stepMs <= ADAPTIVE_MAX_STEP_MS)
    assert.ok(a.horizonMs >= a.stepMs)
    assert.ok(a.horizonMs <= PREDICTION_MAX_HORIZON_MS)
  }
  // at the clamps: a very slow / very fast panel still yields sane numbers
  const slow = frameAdaptivePrediction(40)
  assert.equal(slow.stepMs, ADAPTIVE_MAX_STEP_MS)
  assert.equal(slow.horizonMs, PREDICTION_MAX_HORIZON_MS)
  const fast = frameAdaptivePrediction(2)
  assert.equal(fast.stepMs, ADAPTIVE_MIN_STEP_MS)
  assert.equal(fast.horizonMs, 8)
})

test('predictionTailPath: ghost path starts at the stroke tip, inputs untouched', () => {
  const base = [0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5]
  const tail = [30, 0, 0.5, 40, 0, 0.5]
  const snapshot = JSON.stringify({ base, tail })
  const path = predictionTailPath(base, tail)
  assert.equal(path.length, 3 + tail.length)
  assert.deepEqual(path.slice(0, 3), [20, 0, 0.5]) // last smoothed point === real stroke tip
  assert.deepEqual(path.slice(3), tail)
  assert.equal(JSON.stringify({ base, tail }), snapshot)
  // degenerate base (no full triple yet): tail alone
  assert.deepEqual(predictionTailPath([], tail), tail)
  // a single full triple IS a valid tip
  assert.deepEqual(predictionTailPath([1, 2, 0.5], tail), [1, 2, 0.5, ...tail])
})
