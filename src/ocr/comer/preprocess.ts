/**
 * Stroke polylines → CoMER image tensor.
 *
 * Conventions match CROHME / ink-on: resample about every 3px, draw white ink
 * on black, scale the content to ~128px tall, then place it at the top-left of
 * a 256px-tall canvas whose width is a multiple of 64 (128–1024).
 * No DOM or canvas API — the same function feeds a browser session or native ORT.
 */

export interface StrokePoint {
  x: number
  y: number
}

export interface InkStroke {
  points: StrokePoint[]
  lineWidth: number
}

export interface PreprocessResult {
  tensor: Float32Array
  height: number
  width: number
  mask: Uint8Array
  maskHeight: number
  maskWidth: number
}

export const MODEL_H = 256
const MAX_W = 1024
const MIN_W = 128
const W_ALIGN = 64
const TARGET_H = 128
const PAD = 16

export function resamplePoints(points: StrokePoint[], interval = 3): StrokePoint[] {
  if (points.length < 2) return points.slice()
  const out: StrokePoint[] = [points[0]]
  let remaining = interval
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    const dist = Math.hypot(dx, dy)
    if (dist <= remaining) {
      remaining -= dist
      continue
    }
    let covered = remaining
    while (covered <= dist) {
      const t = covered / dist
      out.push({ x: prev.x + dx * t, y: prev.y + dy * t })
      covered += interval
    }
    remaining = covered - dist
  }
  out.push(points[points.length - 1])
  return out
}

const MIN_STROKE_SIZE = 8
const MIN_TOTAL_POINTS = 6
const MIN_PATH_LENGTH = 15

/** Skip taps and specks. Same gates ink-on uses before it spends a model pass. */
export function isInkMeaningful(strokes: InkStroke[]): boolean {
  const drawn = strokes.filter((s) => s.points.length >= 2)
  if (!drawn.length) return false
  const bbox = bounds(drawn)
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  if (w < MIN_STROKE_SIZE && h < MIN_STROKE_SIZE) return false
  let totalPoints = 0
  let totalLength = 0
  for (const s of drawn) {
    totalPoints += s.points.length
    for (let i = 1; i < s.points.length; i++) {
      const dx = s.points[i].x - s.points[i - 1].x
      const dy = s.points[i].y - s.points[i - 1].y
      totalLength += Math.hypot(dx, dy)
    }
  }
  return totalPoints >= MIN_TOTAL_POINTS && totalLength >= MIN_PATH_LENGTH
}

export function preprocessStrokes(strokes: InkStroke[]): PreprocessResult {
  const drawn = strokes.filter((s) => s.points.length >= 2)
  const bbox = bounds(drawn)
  const rawW = Math.max(1, Math.ceil(bbox.maxX - bbox.minX)) + PAD * 2
  const rawH = Math.max(1, Math.ceil(bbox.maxY - bbox.minY)) + PAD * 2
  const raw = new Float32Array(rawW * rawH)
  for (const stroke of drawn) {
    const pts = resamplePoints(stroke.points).map((p) => ({
      x: p.x - bbox.minX + PAD,
      y: p.y - bbox.minY + PAD,
    }))
    // Canvas stroke width, same as ink-on: diameter, round caps, white on black.
    paintStroke(raw, rawW, rawH, pts, Math.max(2, stroke.lineWidth) / 2)
  }

  const scale = Math.min(TARGET_H / rawH, MAX_W / rawW)
  const dw = Math.max(1, Math.round(rawW * scale))
  const dh = Math.max(1, Math.round(rawH * scale))
  const canvasW = Math.min(MAX_W, Math.max(MIN_W, Math.ceil((dw + PAD) / W_ALIGN) * W_ALIGN))
  const tensor = new Float32Array(MODEL_H * canvasW)
  blit(raw, rawW, rawH, tensor, canvasW, dw, dh)

  const mask = new Uint8Array(MODEL_H * canvasW)
  for (let y = 0; y < MODEL_H; y++) {
    for (let x = 0; x < canvasW; x++) mask[y * canvasW + x] = y < dh && x < dw ? 0 : 1
  }
  return { tensor, height: MODEL_H, width: canvasW, mask, maskHeight: MODEL_H, maskWidth: canvasW }
}

function bounds(strokes: InkStroke[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of strokes) {
    for (const p of s.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  return { minX, minY, maxX, maxY }
}

/** Quadratic smoothing matches canvas `quadraticCurveTo` + a final `lineTo`. */
function paintStroke(buf: Float32Array, w: number, h: number, pts: StrokePoint[], radius: number) {
  const path = canvasPath(pts)
  for (const p of path) stamp(buf, w, h, p.x, p.y, radius)
}

function canvasPath(pts: StrokePoint[]): StrokePoint[] {
  if (pts.length < 2) return pts.slice()
  if (pts.length === 2) return densify(pts[0], pts[1])
  const out: StrokePoint[] = []
  let from = pts[0]
  for (let i = 1; i < pts.length - 1; i++) {
    const ctrl = pts[i]
    const to = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
    appendQuad(out, from, ctrl, to)
    from = to
  }
  const tail = densify(from, pts[pts.length - 1])
  if (out.length) tail.shift()
  out.push(...tail)
  return out
}

function appendQuad(out: StrokePoint[], from: StrokePoint, ctrl: StrokePoint, to: StrokePoint) {
  const len = Math.hypot(ctrl.x - from.x, ctrl.y - from.y) + Math.hypot(to.x - ctrl.x, to.y - ctrl.y)
  const steps = Math.max(2, Math.ceil(len / 0.6))
  for (let s = out.length ? 1 : 0; s <= steps; s++) {
    const t = s / steps
    const u = 1 - t
    out.push({
      x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
    })
  }
}

function densify(a: StrokePoint, b: StrokePoint): StrokePoint[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.6))
  const out: StrokePoint[] = []
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

function stamp(buf: Float32Array, w: number, h: number, cx: number, cy: number, r: number) {
  const x0 = Math.max(0, Math.floor(cx - r - 1))
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 1))
  const y0 = Math.max(0, Math.floor(cy - r - 1))
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 1))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const cov = dist <= r - 0.7 ? 1 : dist >= r + 0.7 ? 0 : (r + 0.7 - dist) / 1.4
      if (cov <= 0) continue
      const i = y * w + x
      if (cov > buf[i]) buf[i] = cov
    }
  }
}

function blit(src: Float32Array, sw: number, sh: number, dst: Float32Array, dstW: number, dw: number, dh: number) {
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) * sh) / dh - 0.5
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)))
    const y1 = Math.max(0, Math.min(sh - 1, y0 + 1))
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * sw) / dw - 0.5
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)))
      const x1 = Math.max(0, Math.min(sw - 1, x0 + 1))
      const fx = sx - x0
      const v =
        src[y0 * sw + x0] * (1 - fx) * (1 - fy) +
        src[y0 * sw + x1] * fx * (1 - fy) +
        src[y1 * sw + x0] * (1 - fx) * fy +
        src[y1 * sw + x1] * fx * fy
      dst[y * dstW + x] = v
    }
  }
}
