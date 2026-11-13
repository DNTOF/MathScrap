/**
 * Ink smoothing primitives — pure functions.
 *
 * Approach (idea learned from studying established whiteboard behaviour, not code):
 * drop near-duplicate samples, then treat the stroke as the midpoint quadratic
 * Bézier — adjacent sample midpoints are the curve ends, the original sample is
 * the control point. Endpoints stay pinned so taps and dots are untouched.
 */

export interface InkPoint {
  x: number
  y: number
  pressure: number
}

/** Near-point threshold in DIP (CSS px) for the smoothing experiment (main uses a looser 0.8). */
export const SMOOTH_MIN_DIST_DIP = 0.5

/** How many polyline samples each quadratic curve segment is subdivided into. */
export const BEZIER_SAMPLES_PER_CURVE = 6

/**
 * Append one real sample to a flat [x, y, pressure, ...] stroke, skipping points
 * closer than `minScreenDist` screen px to the current tip (world coords + view
 * scale → screen distance, same rule main applies inline with 0.8).
 * Pure: returns a new array, or the same array when the point is skipped.
 */
export function appendStrokePoint(pts: number[], p: InkPoint, minScreenDist: number, scale: number): number[] {
  const n = pts.length
  if (n >= 3) {
    const dx = p.x - pts[n - 3]
    const dy = p.y - pts[n - 2]
    if (Math.hypot(dx, dy) * scale < minScreenDist) return pts
  }
  return [...pts, p.x, p.y, p.pressure]
}

const quad = (c0: number, c1: number, c2: number, t: number) => {
  const u = 1 - t
  return u * u * c0 + 2 * u * t * c1 + t * t * c2
}

/** Piecewise-linear pressure between the three control samples of one curve segment. */
const quadPressure = (p0: number, p1: number, p2: number, t: number) =>
  t <= 0.5 ? p0 + (p1 - p0) * t * 2 : p1 + (p2 - p1) * (t - 0.5) * 2

/**
 * Push the samples of curve segment i (control point P[i], ends at the adjacent
 * midpoints) into `out`. Shared by the whole-stroke resample and the incremental
 * cache, so wet (incremental) and dry (resampled) shapes are identical by
 * construction, not just by coincidence of math.
 */
function pushSegmentSamples(pts: number[], i: number, samplesPerCurve: number, out: number[]): void {
  const ax = (pts[(i - 1) * 3] + pts[i * 3]) / 2
  const ay = (pts[(i - 1) * 3 + 1] + pts[i * 3 + 1]) / 2
  const bx = (pts[i * 3] + pts[(i + 1) * 3]) / 2
  const by = (pts[(i + 1) * 3 + 1] + pts[(i + 1) * 3 + 1]) / 2
  const cx = pts[i * 3]
  const cy = pts[i * 3 + 1]
  const pa = pts[(i - 1) * 3 + 2]
  const pc = pts[i * 3 + 2]
  const pb = pts[(i + 1) * 3 + 2]
  for (let s = 1; s <= samplesPerCurve; s++) {
    const t = s / samplesPerCurve
    out.push(quad(ax, cx, bx, t), quad(ay, cy, by, t), quadPressure(pa, pc, pb, t))
  }
}

/**
 * Sample the midpoint quadratic Bézier through the stroke as a flat
 * [x, y, pressure, ...] polyline. The first and last samples are preserved
 * exactly (value and identity of the array when there is nothing to smooth);
 * pressure is interpolated between samples. Strokes with fewer than 3 samples
 * (dots, two-point lines) are returned unchanged.
 */
export function midpointBezierPolyline(pts: number[], samplesPerCurve = BEZIER_SAMPLES_PER_CURVE): number[] {
  const n = pts.length / 3
  if (n < 3) return pts
  const out: number[] = [pts[0], pts[1], pts[2]]
  for (let i = 1; i < n - 1; i++) pushSegmentSamples(pts, i, samplesPerCurve, out)
  out.push(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2])
  return out
}

// --- incremental wet-ink smoothing -------------------------------------------
//
// A midpoint-Bézier segment for control point P[i] only ever depends on
// P[i-1..i+1], so each segment is final the moment P[i+1] arrives: the smoothed
// prefix never changes as the stroke grows. The incremental cache exploits that
// to render wet ink with O(1) work per pointer event instead of resampling the
// whole stroke every frame, while staying bit-identical to the dry bake.

export interface IncrementalSmoothState {
  /** smoothed polyline so far (flat triples); === the input array while < 3 samples */
  pts: number[]
  /** curve segments already emitted (segments 1..emitted are final) */
  emitted: number
}

export function createIncrementalSmooth(): IncrementalSmoothState {
  return { pts: [], emitted: 0 }
}

/**
 * Feed the (full, growing) stroke into the cache and return it. The result's
 * `pts` equals `midpointBezierPolyline(pts)` for every prefix — wet and dry
 * shapes match exactly at every frame. Mutates and returns `state`; `pts` is
 * only read. Calling it again with an unchanged stroke is a no-op.
 */
export function updateIncrementalSmooth(state: IncrementalSmoothState, pts: number[], samplesPerCurve = BEZIER_SAMPLES_PER_CURVE): IncrementalSmoothState {
  const n = pts.length / 3
  if (n < 3) {
    state.pts = pts
    state.emitted = 0
    return state
  }
  if (state.emitted === 0) {
    // cold start (also covers being attached to a stroke already in progress)
    state.pts = [pts[0], pts[1], pts[2]]
  } else {
    state.pts.length -= 3 // drop the previous trailing endpoint
  }
  for (let i = state.emitted + 1; i <= n - 2; i++) pushSegmentSamples(pts, i, samplesPerCurve, state.pts)
  state.emitted = n - 2
  state.pts.push(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2])
  return state
}
