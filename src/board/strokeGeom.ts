import type { Stroke } from './types'

export function strokeBounds(strokes: Stroke[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes)
    for (let i = 0; i < s.pts.length; i += 3) {
      x0 = Math.min(x0, s.pts[i])
      y0 = Math.min(y0, s.pts[i + 1])
      x1 = Math.max(x1, s.pts[i])
      y1 = Math.max(y1, s.pts[i + 1])
    }
  return { x0, y0, x1, y1 }
}

function reach(s: Stroke, r: number) {
  return r + s.width * (s.style === 'marker' || s.style === 'washi' ? 2.5 : 0.8)
}

function pointSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax
  const aby = by - ay
  const l2 = abx * abx + aby * aby
  if (l2 === 0) {
    const dx = px - ax
    const dy = py - ay
    return dx * dx + dy * dy
  }
  let t = ((px - ax) * abx + (py - ay) * aby) / l2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const dx = px - (ax + t * abx)
  const dy = py - (ay + t * aby)
  return dx * dx + dy * dy
}

function segmentsMeet(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const rx = bx - ax
  const ry = by - ay
  const sx = dx - cx
  const sy = dy - cy
  const den = rx * sy - ry * sx
  if (den === 0) return false
  const qpx = cx - ax
  const qpy = cy - ay
  const t = (qpx * sy - qpy * sx) / den
  const u = (qpx * ry - qpy * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

export function hitStroke(s: Stroke, x: number, y: number, r: number) {
  const r2 = reach(s, r) ** 2
  const p = s.pts
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - x
    const dy = p[i + 1] - y
    if (dx * dx + dy * dy <= r2) return true
    if (i + 3 < p.length && pointSegDist2(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= r2) return true
  }
  return false
}

/**
 * True when the eraser travelled from (x0, y0) to (x1, y1).
 * A fast move has no sample on the stroke itself; the segment still has to hit.
 */
export function hitStrokeCapsule(s: Stroke, x0: number, y0: number, x1: number, y1: number, r: number) {
  const limit2 = reach(s, r) ** 2
  const p = s.pts
  if (p.length < 3) return false
  for (let i = 0; i < p.length; i += 3) {
    if (pointSegDist2(p[i], p[i + 1], x0, y0, x1, y1) <= limit2) return true
    if (i + 3 >= p.length) continue
    const ax = p[i]
    const ay = p[i + 1]
    const bx = p[i + 3]
    const by = p[i + 4]
    if (segmentsMeet(ax, ay, bx, by, x0, y0, x1, y1)) return true
    const dist2 = Math.min(pointSegDist2(ax, ay, x0, y0, x1, y1), pointSegDist2(bx, by, x0, y0, x1, y1), pointSegDist2(x0, y0, ax, ay, bx, by), pointSegDist2(x1, y1, ax, ay, bx, by))
    if (dist2 <= limit2) return true
  }
  return false
}
