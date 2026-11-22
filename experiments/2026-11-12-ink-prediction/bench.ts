/**
 * Light micro-benchmark for the ink prototype modules (Node + tsx, single thread).
 *
 *   npx tsx experiments/2026-11-12-ink-prediction/bench.ts
 *
 * Deliberately CPU-light (a few seconds total, no GPU, no build) — safe to run
 * next to the OCR timing job. Numbers are per single call; the "frame budget"
 * section adds up the calls one rendered frame would actually make.
 */
import { hitSweep } from '../../src/ink/capsule'
import { gateSamples, predictTail, type InkSample } from '../../src/ink/predict'
import { appendStrokePoint, createIncrementalSmooth, midpointBezierPolyline, updateIncrementalSmooth } from '../../src/ink/smooth'
import type { Stroke } from '../../src/board/types'

const now = () => performance.now()

function bench(name: string, fn: () => unknown, minIter: number, budgetMs: number): number {
  for (let i = 0; i < 5; i++) fn() // warmup
  let iter = 0
  const t0 = now()
  let elapsed = 0
  do {
    fn()
    iter++
    elapsed = now() - t0
  } while (elapsed < budgetMs || iter < minIter)
  const perCallUs = (elapsed / iter) * 1000
  console.log(`${name.padEnd(56)} ${perCallUs.toFixed(1).padStart(9)} µs/call (${String(iter)} iters)`)
  return perCallUs
}

/** synthetic handwriting-ish stroke: gentle waves, flat [x, y, pressure, ...] */
function makeStrokePts(n: number): number[] {
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1)
    pts.push(t * 800, 300 + Math.sin(t * Math.PI * 6) * 120 + Math.sin(t * Math.PI * 23) * 8, 0.5)
  }
  return pts
}

const strokeOf = (pts: number[]): Stroke => ({ id: 'bench', pts, color: '#000', width: 4, style: 'ink', createdAt: 0 })

/** slightly curving drag, 8 ms sampling */
function makeSamples(n: number): InkSample[] {
  let x = 0
  let y = 0
  let heading = 0
  return Array.from({ length: n }, (_, i) => {
    heading += 0.03
    x += Math.cos(heading) * 5.6
    y += Math.sin(heading) * 5.6
    return { x, y, t: 1000 + i * 8 }
  })
}

console.log('--- ink prototype micro-benchmark (Node, single thread) ---')
const pts200 = makeStrokePts(200)
const pts2000 = makeStrokePts(2000)

const tSmooth200 = bench('smooth: midpointBezierPolyline 200 pts (per wet frame)', () => midpointBezierPolyline(pts200), 50, 400)
const tSmooth2000 = bench('smooth: midpointBezierPolyline 2000 pts (stress)', () => midpointBezierPolyline(pts2000), 20, 600)

const samples20 = makeSamples(20)
const samples96 = makeSamples(96)
bench('predict: gateSamples (20-sample window)', () => gateSamples(samples20), 100, 200)
const tGate96 = bench('predict: gateSamples (96-sample window = cap)', () => gateSamples(samples96), 100, 200)
bench('predict: predictTail (20 samples → 33 ms)', () => predictTail(samples20, { horizonMs: 33 }), 100, 200)
const tPredict96 = bench('predict: predictTail (96 samples → 33 ms)', () => predictTail(samples96, { horizonMs: 33 }), 100, 200)

const stroke200 = strokeOf(pts200)
const stroke2000 = strokeOf(pts2000)
bench('eraser: hitSweep miss on 200-pt stroke', () => hitSweep(stroke200, -50, 500, -40, 520, 12), 100, 300)
bench('eraser: hitSweep miss on 2000-pt stroke', () => hitSweep(stroke2000, -50, 500, -40, 520, 12), 20, 400)
const hitX = pts2000[999 * 3]
const hitY = pts2000[999 * 3 + 1]
bench('eraser: hitSweep hit mid-stroke on 2000-pt stroke', () => hitSweep(stroke2000, hitX, hitY, hitX + 2, hitY + 2, 12), 20, 400)
bench('capture: appendStrokePoint onto 2000-pt stroke', () => appendStrokePoint(pts2000, { x: 1e6, y: 1e6, pressure: 0.5 }, 0.5, 1), 100, 300)

const docStrokes = Array.from({ length: 20 }, () => strokeOf(makeStrokePts(200)))
const tEraseFrame = bench('eraser frame: sweep over 20 × 200-pt strokes (all miss)', () => {
  for (const s of docStrokes) hitSweep(s, -50, 500, -40, 520, 12)
}, 20, 400)

console.log('\n--- wet-ink redraw: full resample vs incremental (2000-point stroke) ---')
// model the Board: the pts array grows by one sample per pointer event and the
// smoother reads it in place (no extra copying on either side)
const fullPts: number[] = []
const fullStart = now()
for (let k = 1; k <= 2000; k++) {
  fullPts.push(k, 300 + Math.sin(k / 200) * 100, 0.5)
  if (k >= 3) midpointBezierPolyline(fullPts)
}
const fullMs = now() - fullStart
const incPts: number[] = []
const incState = createIncrementalSmooth()
const incStart = now()
for (let k = 1; k <= 2000; k++) {
  incPts.push(k, 300 + Math.sin(k / 200) * 100, 0.5)
  if (k >= 3) updateIncrementalSmooth(incState, incPts)
}
const incMs = now() - incStart
const fullPerEventUs = (fullMs / 1998) * 1000
const incPerEventUs = (incMs / 1998) * 1000
console.log(`full resample every event: ${fullMs.toFixed(2)} ms total, ${fullPerEventUs.toFixed(1)} µs/event avg (last event ≈ ${tSmooth2000.toFixed(0)} µs)`)
console.log(`incremental per event:     ${incMs.toFixed(2)} ms total, ${incPerEventUs.toFixed(1)} µs/event avg (${(fullMs / Math.max(incMs, 0.001)).toFixed(0)}× faster)`)
console.log(`wet/dry shape equality is asserted by unit tests, not here`)

console.log('\n--- per-frame budget (target: < 1 ms) ---')
const realistic = tSmooth200 + tGate96 + tPredict96 + tEraseFrame
const stress = tSmooth2000 + tGate96 + tPredict96 + tEraseFrame
const realisticInc = incPerEventUs + tGate96 + tPredict96 + tEraseFrame
console.log(`realistic frame (200-pt live stroke)          = ${(realistic / 1000).toFixed(3)} ms  ${realistic < 1000 ? '✓ under budget' : '✗ over budget'}`)
console.log(`realistic frame with wetIncremental           = ${(realisticInc / 1000).toFixed(3)} ms  ${realisticInc < 1000 ? '✓ under budget' : '✗ over budget'}`)
console.log(`stress frame (2000-pt live stroke)            = ${(stress / 1000).toFixed(3)} ms  ${stress < 1000 ? '✓ under budget' : '✗ over budget'}`)
