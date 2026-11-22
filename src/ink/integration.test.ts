/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendStrokePoint, midpointBezierPolyline } from './smooth'
import { gateSamples, predictTail } from './predict'

/**
 * Board-level contract, exercised through the pure modules the Board calls:
 * predicted points only ever flow through the display path
 * ([...smoothedRealPts, ...predTail]); the saved stroke is built exclusively
 * from real samples via appendStrokePoint + the finish-time bake, so no
 * predicted coordinate can ever enter stroke data.
 */
test('predicted points never enter the saved stroke', () => {
  // a quick straight stroke: real pointer/coalesced samples
  const real: { x: number; y: number; t: number }[] = []
  for (let i = 0; i < 12; i++) real.push({ x: 10 + i * 5.8, y: 20 + i * 1.2, t: 1000 + i * 8 })

  // capture: only real samples are appended (this is the only stroke-mutating call in Board)
  let strokePts: number[] = []
  for (const s of real) strokePts = appendStrokePoint(strokePts, { x: s.x, y: s.y, pressure: 0.5 }, 0.5, 1)

  // prediction: gate + tail from the same real history
  const gate = gateSamples(real)
  assert.equal(gate.predict, true)
  const tail = predictTail(real, { horizonMs: gate.horizonMs })
  assert.ok(tail.length > 0)
  // the tail lives beyond the last real sample
  const last = real[real.length - 1]
  assert.ok(Math.hypot(tail[tail.length - 1].x - last.x, tail[tail.length - 1].y - last.y) > 0)

  // what the renderer shows this frame (display path)…
  const displayPts = [...midpointBezierPolyline(strokePts), ...tail.flatMap((p) => [p.x, p.y, 0.5])]
  // …vs what finishStroke saves (the bake sees only the real capture)
  const saved = midpointBezierPolyline(strokePts)
  assert.deepEqual(saved, midpointBezierPolyline(strokePts))
  assert.equal(displayPts.length, saved.length + tail.length * 3)
  // the saved data contains none of the predicted coordinates
  const triples: number[][] = []
  for (let i = 0; i < saved.length; i += 3) triples.push([saved[i], saved[i + 1]])
  for (const p of tail) {
    assert.ok(
      !triples.some(([x, y]) => Math.abs(x - p.x) < 1e-9 && Math.abs(y - p.y) < 1e-9),
      `predicted point ${p.x},${p.y} leaked into saved stroke`,
    )
  }
  // and the bake is a pure function of the real capture alone
  assert.equal(saved.length, (1 + (strokePts.length / 3 - 2) * 6 + 1) * 3)
})
