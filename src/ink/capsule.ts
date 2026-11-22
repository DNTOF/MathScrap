/**
 * Swept-capsule eraser hit testing — pure functions.
 *
 * Idea learned from studying established whiteboards (not their code): test the
 * capsule the eraser swept through since the previous pointer position, not just
 * the point it sits on now, so fast motion cannot skip over a stroke.
 */
import type { Stroke } from '@/board/types'

export interface Pt {
  x: number
  y: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Squared distance between segments p1p2 and q1q2; degenerate segments count as points. */
export function segSegDist2(p1: Pt, p2: Pt, q1: Pt, q2: Pt): number {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = q2.x - q1.x
  const d2y = q2.y - q1.y
  const rx = p1.x - q1.x
  const ry = p1.y - q1.y
  const a = d1x * d1x + d1y * d1y
  const e = d2x * d2x + d2y * d2y
  const f = d2x * rx + d2y * ry
  let s: number
  let t: number
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0
    t = 0
  } else if (a <= 1e-12) {
    s = 0
    t = clamp01(f / e)
  } else {
    const c = d1x * rx + d1y * ry
    if (e <= 1e-12) {
      t = 0
      s = clamp01(-c / a)
    } else {
      const b = d1x * d2x + d1y * d2y
      const denom = a * e - b * b
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp01(-c / a)
      } else if (t > 1) {
        t = 1
        s = clamp01((b - c) / a)
      }
    }
  }
  const cx = p1.x + s * d1x - (q1.x + t * d2x)
  const cy = p1.y + s * d1y - (q1.y + t * d2y)
  return cx * cx + cy * cy
}

/** Same width padding rule as hitStroke() in board/strokes.tsx. */
const sweepPad = (s: Stroke) => s.width * (s.style === 'marker' || s.style === 'washi' ? 2.5 : 0.8)

/**
 * Does the capsule swept from (x0,y0) to (x1,y1) with radius r touch the stroke?
 * A stationary test (x0==x1, y0==y1) degenerates to the usual disc check.
 */
export function hitSweep(s: Stroke, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  const rr = r + sweepPad(s)
  const r2 = rr * rr
  const p = s.pts
  const n = p.length / 3
  if (n === 0) return false
  const a1: Pt = { x: x0, y: y0 }
  const a2: Pt = { x: x1, y: y1 }
  if (n === 1) return segSegDist2(a1, a2, { x: p[0], y: p[1] }, { x: p[0], y: p[1] }) <= r2
  for (let i = 0; i < n - 1; i++) {
    const b1: Pt = { x: p[i * 3], y: p[i * 3 + 1] }
    const b2: Pt = { x: p[(i + 1) * 3], y: p[(i + 1) * 3 + 1] }
    if (segSegDist2(a1, a2, b1, b2) <= r2) return true
  }
  return false
}
