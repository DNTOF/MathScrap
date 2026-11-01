import type { InkStroke, StrokePoint } from './preprocess.ts'

/**
 * CoMER often reads an isolated handwritten σ as 0, Y, or u.
 * Only those whole-glyph readings are rewritten, and only when the ink
 * itself has the loop-plus-tail of σ. A sentence, a real zero, a fork,
 * or a bowl is left alone — this does not invent an equation.
 */
const MISREAD = /^(?:0|O|o|Y|y|u|U)$/

export function repairIsolatedSigma(strokes: InkStroke[], modelText: string): string | null {
  const text = modelText.replace(/\s+/g, '')
  if (!MISREAD.test(text)) return null
  if (!looksLikeIsolatedSigma(strokes)) return null
  return 'sigma'
}

export function looksLikeIsolatedSigma(strokes: InkStroke[]): boolean {
  const drawn = strokes.filter((s) => s.points.length >= 4 && arcLength(s.points) >= 22)
  if (drawn.length !== 1) return false
  const pts = drawn[0].points
  const b = bounds(pts)
  if (b.w < 16 || b.h < 16) return false
  const aspect = b.h / b.w
  if (aspect < 0.5 || aspect > 2.15) return false
  const diag = Math.hypot(b.w, b.h)
  const len = arcLength(pts)
  if (len < diag * 1.65 || len > diag * 5.5) return false
  const turn = totalTurn(pts)
  if (turn < 3.5 || turn > 8.8) return false

  const cum = cumulative(pts)
  const endGap = dist(pts[0], pts[pts.length - 1])
  const approach = nearestApproach(pts, cum)
  const body = centroid(pts, cum, 0, 1)
  const cv = radiusCv(pts, cum, body, 0, 1)
  const tail = hasOutwardTail(pts, cum)

  // A zero meets itself and stays inside its own bowl. σ leaves a gap or a tail.
  const closedOval = endGap < diag * 0.1 && cv < 0.25 && !tail
  if (closedOval) return false
  if (plainBowl(pts, b, endGap, turn, approach, diag)) return false
  if (topFork(pts, b)) return false

  const hook = terminalHook(pts, cum)
  const loop = approach < diag * 0.34 && endGap > diag * 0.08
  return hook || (loop && (tail || endGap > diag * 0.2))
}

function plainBowl(pts: StrokePoint[], b: ReturnType<typeof bounds>, endGap: number, turn: number, approach: number, diag: number): boolean {
  const y0 = (pts[0].y - b.y0) / b.h
  const y1 = (pts[pts.length - 1].y - b.y0) / b.h
  return y0 < 0.3 && y1 < 0.3 && endGap > b.w * 0.4 && turn < 4.5 && approach > diag * 0.32
}

/** A sharp peak in the upper half, with arms leaving both ways: a Y, not σ. */
function topFork(pts: StrokePoint[], b: ReturnType<typeof bounds>): boolean {
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const c = pts[i]
    const d = pts[i + 1]
    const v1 = unit(a, c)
    const v2 = unit(c, d)
    if (!v1 || !v2) continue
    const dot = v1.x * v2.x + v1.y * v2.y
    if (dot > 0.35) continue
    const high = c.y < b.y0 + b.h * 0.55
    const opensUp = a.y < c.y + 4 && d.y < c.y + 4 && Math.abs(a.x - d.x) > b.w * 0.35
    if (high && opensUp) return true
  }
  return false
}

function terminalHook(pts: StrokePoint[], cum: number[]): boolean {
  const mid = chord(pts, cum, 0.5, 0.72)
  const end = chord(pts, cum, 0.82, 1)
  if (!mid || !end) return false
  return mid.x * end.x + mid.y * end.y < 0.2
}

/** The last fifth leaves the box of the earlier ink: a tail, not the close of a circle. */
function hasOutwardTail(pts: StrokePoint[], cum: number[]): boolean {
  const total = cum[cum.length - 1]
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let n = 0
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > total * 0.8) break
    x0 = Math.min(x0, pts[i].x)
    y0 = Math.min(y0, pts[i].y)
    x1 = Math.max(x1, pts[i].x)
    y1 = Math.max(y1, pts[i].y)
    n++
  }
  if (n < 4) return false
  const pad = Math.max(4, Math.hypot(x1 - x0, y1 - y0) * 0.06)
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] < total * 0.84) continue
    const p = pts[i]
    if (p.x < x0 - pad || p.x > x1 + pad || p.y < y0 - pad || p.y > y1 + pad) return true
  }
  return false
}

function nearestApproach(pts: StrokePoint[], cum: number[]): number {
  const total = cum[cum.length - 1]
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > total * 0.4) break
    for (let j = pts.length - 1; j > i; j--) {
      if (cum[j] < total * 0.6) break
      if (cum[j] - cum[i] < total * 0.35) continue
      const d = dist(pts[i], pts[j])
      if (d < best) best = d
    }
  }
  return best
}

function totalTurn(pts: StrokePoint[]): number {
  let turn = 0
  let prev: { x: number; y: number } | null = null
  for (let i = 1; i < pts.length; i++) {
    const dir = unit(pts[i - 1], pts[i])
    if (!dir) continue
    if (prev) turn += Math.acos(clamp(prev.x * dir.x + prev.y * dir.y, -1, 1))
    prev = dir
  }
  return turn
}

function radiusCv(pts: StrokePoint[], cum: number[], c: StrokePoint, from: number, to: number): number {
  const total = cum[cum.length - 1]
  const rs: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const t = cum[i] / total
    if (t < from || t > to) continue
    rs.push(dist(pts[i], c))
  }
  if (rs.length < 4) return 1
  const mean = rs.reduce((s, r) => s + r, 0) / rs.length
  if (mean < 1) return 1
  const variance = rs.reduce((s, r) => s + (r - mean) ** 2, 0) / rs.length
  return Math.sqrt(variance) / mean
}

function centroid(pts: StrokePoint[], cum: number[], from: number, to: number): StrokePoint {
  const total = cum[cum.length - 1]
  let x = 0
  let y = 0
  let n = 0
  for (let i = 0; i < pts.length; i++) {
    const t = total === 0 ? 0 : cum[i] / total
    if (t < from || t > to) continue
    x += pts[i].x
    y += pts[i].y
    n++
  }
  if (!n) return pts[0]
  return { x: x / n, y: y / n }
}

function chord(pts: StrokePoint[], cum: number[], from: number, to: number): { x: number; y: number } | null {
  const a = pointAt(pts, cum, from)
  const b = pointAt(pts, cum, to)
  if (!a || !b) return null
  return unit(a, b)
}

function pointAt(pts: StrokePoint[], cum: number[], fraction: number): StrokePoint | null {
  const target = cum[cum.length - 1] * fraction
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] + 1e-9 < target) continue
    const span = cum[i] - cum[i - 1]
    const t = span < 1e-9 ? 0 : (target - cum[i - 1]) / span
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
  }
  return pts[pts.length - 1] ?? null
}

function cumulative(pts: StrokePoint[]): number[] {
  const out = [0]
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]))
  return out
}

function arcLength(pts: StrokePoint[]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i])
  return n
}

function unit(a: StrokePoint, b: StrokePoint): { x: number; y: number } | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 0.8) return null
  return { x: dx / len, y: dy / len }
}

function dist(a: StrokePoint, b: StrokePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function bounds(pts: StrokePoint[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}
