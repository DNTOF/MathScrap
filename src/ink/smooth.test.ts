/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendStrokePoint,
  BEZIER_SAMPLES_PER_CURVE,
  createIncrementalSmooth,
  midpointBezierPolyline,
  SMOOTH_MIN_DIST_DIP,
  updateIncrementalSmooth,
} from './smooth'

const triple = (pts: number[], i: number) => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]

test('appendStrokePoint drops near points (0.5 DIP default)', () => {
  const s = appendStrokePoint([], { x: 10, y: 10, pressure: 0.5 }, SMOOTH_MIN_DIST_DIP, 1)
  assert.equal(s.length, 3)
  // 0.1 screen px away → skipped
  const near = appendStrokePoint(s, { x: 10.1, y: 10, pressure: 0.5 }, SMOOTH_MIN_DIST_DIP, 1)
  assert.equal(near, s) // same array when skipped
  // 2 screen px away → appended
  const far = appendStrokePoint(s, { x: 12.1, y: 10, pressure: 0.6 }, SMOOTH_MIN_DIST_DIP, 1)
  assert.equal(far.length, 6)
  assert.deepEqual(triple(far, 1), [12.1, 10, 0.6])
})

test('appendStrokePoint threshold is in screen px (world × scale)', () => {
  const s = [0, 0, 0.5]
  // world distance 1 at zoom 4 → 4 screen px → appended even though 1 < 0.5 is false
  const at = appendStrokePoint(s, { x: 1, y: 0, pressure: 0.5 }, SMOOTH_MIN_DIST_DIP, 4)
  assert.equal(at.length, 6)
  // world distance 0.1 at zoom 1 → 0.1 screen px → skipped
  const skipped = appendStrokePoint(s, { x: 0.1, y: 0, pressure: 0.5 }, SMOOTH_MIN_DIST_DIP, 1)
  assert.equal(skipped, s)
})

test('flag-off equivalence: appendStrokePoint at 0.8 reproduces the main inline loop', () => {
  // literal port of the main-branch capture loop for comparison
  const mainAppend = (pts: number[], x: number, y: number, pressure: number, scale: number) => {
    const out = pts.slice()
    const lx = out[out.length - 3] as number
    const ly = out[out.length - 2] as number
    if (Math.hypot(x - lx, y - ly) * scale < 0.8) return out
    out.push(x, y, pressure)
    return out
  }
  const events: [number, number, number, number][] = [
    [0, 0, 1, 1],
    [0.3, 0.4, 1, 1],
    [0.6, 0.8, 1, 1],
    [2, 3, 1, 1],
    [2.1, 3.05, 1, 1],
    [5, 7, 1, 1],
    [5.4, 7.3, 1, 1],
    [9, 9, 1, 2],
  ]
  let a: number[] = []
  let b: number[] = []
  for (const [x, y, pressure, scale] of events) {
    a = appendStrokePoint(a, { x, y, pressure }, 0.8, scale)
    b = mainAppend(b, x, y, pressure, scale)
  }
  assert.deepEqual(a, b)
})

test('midpointBezierPolyline keeps endpoints exact', () => {
  const pts = [0, 0, 0.5, 10, 12, 0.5, 24, 2, 0.5, 40, 30, 0.5]
  const out = midpointBezierPolyline(pts)
  assert.deepEqual(triple(out, 0), triple(pts, 0))
  const last = out.length / 3 - 1
  assert.deepEqual(triple(out, last), triple(pts, pts.length / 3 - 1))
  // 1 + (n-2)*samples + 1 points
  assert.equal(out.length, (1 + 2 * BEZIER_SAMPLES_PER_CURVE + 1) * 3)
})

test('midpointBezierPolyline leaves dots and two-point strokes untouched', () => {
  const dot = [3, 4, 0.5]
  const line = [0, 0, 0.5, 10, 10, 0.7]
  assert.equal(midpointBezierPolyline(dot), dot)
  assert.equal(midpointBezierPolyline(line), line)
})

test('midpointBezierPolyline passes through sample midpoints (no corner cutting to NaN)', () => {
  const pts = [0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5]
  const out = midpointBezierPolyline(pts)
  for (let i = 0; i < out.length; i++) assert.ok(Number.isFinite(out[i]), `non-finite at ${i}`)
  // single curve segment: out[0] = P0, sample s lands at index s → t=0.5 is index 3,
  // exactly on the control point (the original sample)
  const mid = triple(out, BEZIER_SAMPLES_PER_CURVE / 2)
  assert.deepEqual(mid, [10, 0, 0.5])
})

test('smoothing output is NaN-free for nasty finite inputs', () => {
  const nasties = [
    [0, 0, 0.5, 5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.5, 20, 20, 0.5], // repeated points
    [0, 0, 0, 1, 0, 1, 2, 0, 0, 3, 0, 1, 4, 0, 0], // zig-zag pressure
    [1e6, -1e6, 0.5, 1e6 + 0.001, 1e6, 0.5, 2e6, 2e6, 0.5], // huge spans
  ]
  for (const pts of nasties) {
    const out = midpointBezierPolyline(pts)
    for (let i = 0; i < out.length; i++) assert.ok(Number.isFinite(out[i]), `non-finite at ${i}`)
  }
})

test('pressure is interpolated within the neighbouring range', () => {
  const pts = [0, 0, 0.2, 10, 0, 0.8, 20, 0, 0.4]
  const out = midpointBezierPolyline(pts)
  for (let i = 2; i < out.length; i += 3) {
    assert.ok(out[i] >= 0.2 && out[i] <= 0.8, `pressure out of range: ${out[i]}`)
  }
})

// --- incremental wet-ink smoothing ---

/** synthetic wavy stroke with n points (same shape family as the benchmark) */
const wavy = (n: number): number[] => {
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1)
    pts.push(t * 800, 300 + Math.sin(t * Math.PI * 6) * 120, 0.5)
  }
  return pts
}

test('incremental smoothing matches the full resample at every prefix', () => {
  const pts = wavy(200)
  const st = createIncrementalSmooth()
  for (let k = 1; k <= 200; k++) {
    const partial = pts.slice(0, k * 3)
    const out = updateIncrementalSmooth(st, partial)
    assert.deepEqual(out.pts, midpointBezierPolyline(partial), `wet/dry mismatch at ${k} points`)
    assert.equal(out, st) // same state object, mutated in place
  }
})

test('incremental smoothing: cold start mid-stroke still matches', () => {
  const pts = wavy(120)
  const st = createIncrementalSmooth()
  const out = updateIncrementalSmooth(st, pts) // attached to a stroke already in progress
  assert.deepEqual(out.pts, midpointBezierPolyline(pts))
})

test('incremental smoothing: <3 samples pass through by identity, then grow', () => {
  const st = createIncrementalSmooth()
  const dot = [3, 4, 0.5]
  assert.equal(updateIncrementalSmooth(st, dot).pts, dot)
  const line = [0, 0, 0.5, 10, 10, 0.5]
  assert.equal(updateIncrementalSmooth(st, line).pts, line)
  const grown = updateIncrementalSmooth(st, [0, 0, 0.5, 10, 10, 0.5, 20, 4, 0.5])
  assert.deepEqual(grown.pts, midpointBezierPolyline([0, 0, 0.5, 10, 10, 0.5, 20, 4, 0.5]))
})

test('incremental smoothing: unchanged stroke is a no-op', () => {
  const pts = wavy(50)
  const st = createIncrementalSmooth()
  updateIncrementalSmooth(st, pts)
  const snapshot = st.pts.slice()
  const out = updateIncrementalSmooth(st, pts)
  assert.equal(out.pts.length, snapshot.length)
  assert.deepEqual(out.pts, snapshot)
})

test('incremental smoothing: input array is never mutated', () => {
  const pts = wavy(30)
  const snapshot = pts.slice()
  const st = createIncrementalSmooth()
  updateIncrementalSmooth(st, pts)
  assert.deepEqual(pts, snapshot)
})
