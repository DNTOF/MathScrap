import { findOverArrow } from './comer/bind.ts'
import type { InkStroke, StrokePoint } from './comer/preprocess.ts'

/**
 * Round 1, before CoMER. Layout only: does this ink look like a formula,
 * or like a line of ordinary writing? Native code can call this and skip
 * `recognizeStrokes` when the answer is `text`.
 */
export type InkRole = 'formula' | 'text'

export function classifyInk(strokes: InkStroke[]): InkRole {
  return looksLikeProse(strokes) ? 'text' : 'formula'
}

/** Operators and layout that mean “this is math”, not a sentence. */
export function mathCues(strokes: InkStroke[]): string[] {
  const cues: string[] = []
  if (findOverArrow(strokes)) cues.push('arrow')
  if (hasEquals(strokes)) cues.push('equals')
  if (hasFractionBar(strokes)) cues.push('fraction')
  if (hasSuperscript(strokes)) cues.push('superscript')
  if (hasParen(strokes)) cues.push('paren')
  if (hasSumLike(strokes)) cues.push('sum')
  if (looksLikeIsolatedSigma(strokes)) cues.push('sigma')
  return cues
}

/**
 * Several letter-sized marks on one baseline, and none of the math cues.
 * Notes and labels stay ink; they are not sent to the formula model.
 */
export function looksLikeProse(strokes: InkStroke[]): boolean {
  if (mathCues(strokes).length) return false
  const boxes = strokes
    .filter((s) => s.points.length >= 2)
    .map((s) => bounds(s.points))
    .sort((a, b) => a.x0 - b.x0)
  if (boxes.length < 4) return false
  const heights = boxes.map((b) => b.h).sort((a, b) => a - b)
  const med = heights[Math.floor(heights.length / 2)]
  if (med < 8) return false
  const similar = boxes.every((b) => b.h > med * 0.45 && b.h < med * 2.2)
  const bases = boxes.map((b) => b.y1).sort((a, b) => a - b)
  const base = bases[Math.floor(bases.length / 2)]
  const aligned = boxes.every((b) => Math.abs(b.y1 - base) < med * 0.55)
  const stepped = boxes.every((b, i) => i === 0 || b.cx > boxes[i - 1].cx)
  const all = bounds(strokes.flatMap((s) => s.points))
  return similar && aligned && stepped && all.w > all.h * 1.35
}

/**
 * Tall Σ-shaped stroke with optional limit ticks: treat as math even without "=".
 * A single tall bowl with small marks above and below on the right is the usual handwritten sum.
 * Σ alone, or Σ with at least one limit, counts as a formula cue.
 */
function hasSumLike(strokes: InkStroke[]): boolean {
  const boxes = strokes.filter((s) => s.points.length >= 4).map((s) => ({ s, b: bounds(s.points) }))
  const sigma = boxes.find(({ b }) => b.h > Math.max(28, b.w * 1.35) && b.h / Math.max(1, b.w) > 1.2)
  if (!sigma) return false
  const others = boxes.filter((x) => x !== sigma)
  const topRight = others.some(({ b }) => b.cy < sigma.b.y0 + sigma.b.h * 0.35 && b.cx > sigma.b.cx - 4 && b.h < sigma.b.h * 0.55)
  const botRight = others.some(({ b }) => b.cy > sigma.b.y0 + sigma.b.h * 0.55 && b.cx > sigma.b.cx - 4 && b.h < sigma.b.h * 0.55)
  return others.length === 0 || topRight || botRight
}

/**
 * One open curl whose rightmost point is an endpoint and whose leftmost point
 * sits in the bowl. That is a lowercase σ, not a tall Σ (several horizontal
 * reversals) and not a closed θ / o. Native code can read this without a DOM.
 */
export function looksLikeIsolatedSigma(strokes: InkStroke[]): boolean {
  const drawn = strokes.filter((s) => s.points.length >= 2)
  if (drawn.length !== 1) return false
  const pts = drawn[0].points
  if (pts.length < 6) return false
  const b = bounds(pts)
  if (b.w < 12 || b.h < 12) return false
  if (b.h > b.w * 1.35 && b.h > 28) return false
  if (b.w > b.h * 2.4) return false
  const start = pts[0]
  const end = pts[pts.length - 1]
  const chord = Math.hypot(end.x - start.x, end.y - start.y)
  let path = 0
  let flips = 0
  let prev = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    path += Math.hypot(dx, dy)
    if (Math.abs(dx) < 1.5) continue
    const sign = Math.sign(dx)
    if (prev !== 0 && sign !== prev) flips++
    prev = sign
  }
  // Σ zigzags more than once. A sigma turns from the bowl back toward its tail once.
  if (flips !== 1) return false
  if (chord < Math.max(8, Math.min(b.w, b.h) * 0.28)) return false
  if (path < chord * 1.55) return false
  let right = pts[0]
  let left = pts[0]
  for (const p of pts) {
    if (p.x > right.x) right = p
    if (p.x < left.x) left = p
  }
  const near = (a: StrokePoint, c: StrokePoint) => Math.hypot(a.x - c.x, a.y - c.y) < Math.max(6, b.w * 0.2)
  if (!near(right, start) && !near(right, end)) return false
  if (near(left, start) || near(left, end)) return false
  return true
}

function hasEquals(strokes: InkStroke[]): boolean {
  const flats = strokes.filter((s) => {
    const b = bounds(s.points)
    return b.w > 10 && b.h < b.w * 0.4
  })
  for (let i = 0; i < flats.length; i++) {
    for (let j = i + 1; j < flats.length; j++) {
      const a = bounds(flats[i].points)
      const b = bounds(flats[j].points)
      const [top, bot] = a.cy < b.cy ? [a, b] : [b, a]
      const overlap = Math.min(top.x1, bot.x1) - Math.max(top.x0, bot.x0)
      const gap = bot.y0 - top.y1
      const width = (top.w + bot.w) / 2
      if (overlap > width * 0.55 && gap > width * 0.04 && gap < width * 1.1) return true
    }
  }
  return false
}

function hasFractionBar(strokes: InkStroke[]): boolean {
  const all = bounds(strokes.flatMap((s) => s.points))
  return strokes.some((s) => {
    const b = bounds(s.points)
    if (b.w < all.w * 0.35 || b.h > b.w * 0.35) return false
    const others = strokes.filter((o) => o !== s).flatMap((o) => o.points)
    if (others.length < 4) return false
    const above = others.some((p) => p.y < b.y0 - 4)
    const below = others.some((p) => p.y > b.y1 + 4)
    return above && below
  })
}

function hasSuperscript(strokes: InkStroke[]): boolean {
  const boxes = strokes.filter((s) => s.points.length >= 2).map((s) => bounds(s.points))
  return boxes.some((small) =>
    boxes.some((big) => big !== small && small.h < big.h * 0.62 && small.w < big.w * 0.7 && small.cy < big.y0 + big.h * 0.35 && small.cx > big.cx),
  )
}

function hasParen(strokes: InkStroke[]): boolean {
  return strokes.some((s) => {
    const pts = s.points
    if (pts.length < 4) return false
    const b = bounds(pts)
    if (b.h < Math.max(14, b.w * 1.5)) return false
    const mid = pts[Math.floor(pts.length / 2)]
    const chord = (pts[0].x + pts[pts.length - 1].x) / 2
    return Math.abs(mid.x - chord) > Math.max(3, b.w * 0.25)
  })
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
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: 1, w: 1, h: 1, cx: 0, cy: 0 }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}
