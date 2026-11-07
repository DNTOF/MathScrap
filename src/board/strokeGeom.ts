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

export function hitStroke(s: Stroke, x: number, y: number, r: number) {
  const rr = r + s.width * (s.style === 'marker' || s.style === 'washi' ? 2.5 : 0.8)
  const r2 = rr * rr
  const p = s.pts
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - x
    const dy = p[i + 1] - y
    if (dx * dx + dy * dy <= r2) return true
    if (i + 3 < p.length) {
      const ex = p[i + 3] - p[i]
      const ey = p[i + 4] - p[i + 1]
      const l2 = ex * ex + ey * ey
      if (l2 > 0) {
        const t = Math.max(0, Math.min(1, ((x - p[i]) * ex + (y - p[i + 1]) * ey) / l2))
        const qx = p[i] + t * ex - x
        const qy = p[i + 1] + t * ey - y
        if (qx * qx + qy * qy <= r2) return true
      }
    }
  }
  return false
}
