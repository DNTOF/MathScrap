import type { Stroke } from '../board/types.ts'

export interface InkCandidate {
  text: string
  confidence: number
}

/**
 * Read simple handwritten formulas from stroke geometry.
 *
 * The previous stub scored only the whole-cluster aspect ratio. Any ink wider than
 * it was tall — including a large `y = x`, whose descender keeps the box from going
 * very flat — matched `𝐚 = (1, 2, 2)` first and was shown at a fixed 62%.
 * A vector is an arrow over a letter. A component tuple is only proposed when the
 * ink actually contains parenthesis-shaped strokes.
 */
export function recognizeInk(strokes: Stroke[]): InkCandidate[] {
  if (!strokes.length) return []
  const read = filterAbsurd(strokes, readInk(strokes))
  const ranked = dedupe(read).sort((a, b) => b.confidence - a.confidence || a.text.localeCompare(b.text))
  if (ranked.length) return ranked.slice(0, 4)
  // Keep the confirm chip usable, but never invent a vector and never at the old 62%.
  return [{ text: 'y = x', confidence: 0.24 }]
}

/** Drop readings the strokes cannot support, and cap confident nonsense. */
export function filterAbsurd(strokes: Stroke[], cands: InkCandidate[]): InkCandidate[] {
  const parens = hasParenGeometry(strokes)
  return cands
    .filter((c) => parens || !isComponentTuple(c.text))
    .map((c) => demoteHeavy(strokes, c))
    .filter((c) => c.text.trim().length > 0)
}

export function hasParenGeometry(strokes: Stroke[]): boolean {
  return toMarks(strokes).some((m) => scoreParen([m]) !== null)
}

interface Pt {
  x: number
  y: number
}
interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
  w: number
  h: number
  cy: number
}
interface Mark {
  pts: Pt[]
  b: Box
}
interface Token {
  text: string
  conf: number
}

function readInk(strokes: Stroke[]): InkCandidate[] {
  const marks = toMarks(strokes)
  if (!marks.length) return []
  const tokens = groupMarks(marks).map(classify)
  const joined = joinTokens(tokens)
  if (!joined) return []
  return [joined.confidence >= 0.5 ? joined : { text: joined.text, confidence: Math.min(joined.confidence, 0.38) }]
}

function toMarks(strokes: Stroke[]): Mark[] {
  return strokes
    .map((s) => {
      const pts: Pt[] = []
      for (let i = 0; i + 1 < s.pts.length; i += 3) pts.push({ x: s.pts[i], y: s.pts[i + 1] })
      return { pts, b: boxOf(pts) }
    })
    .filter((m) => m.pts.length >= 2 && (m.b.w > 0 || m.b.h > 0))
}

function groupMarks(marks: Mark[]): Mark[][] {
  const sorted = [...marks].sort((a, b) => a.b.x0 - b.b.x0 || a.b.y0 - b.b.y0)
  const groups: Mark[][] = []
  for (const mark of sorted) {
    let host = -1
    let best = 0.42
    for (let i = 0; i < groups.length; i++) {
      const ratio = Math.max(...groups[i].map((g) => xOverlap(g.b, mark.b)))
      if (ratio > best) {
        best = ratio
        host = i
      }
    }
    if (host >= 0) groups[host].push(mark)
    else groups.push([mark])
  }
  return groups.sort((a, b) => minX(a) - minX(b))
}

function classify(g: Mark[]): Token {
  const arrow = splitArrow(g)
  if (arrow) {
    const body = classify(arrow.body)
    if (/^[a-z]$/.test(body.text)) return { text: `\\vec{${body.text}}`, conf: Math.min(body.conf, 0.86) }
  }
  const eq = scoreEquals(g)
  if (eq) return { text: '=', conf: eq }
  const x = scoreX(g)
  if (x) return { text: 'x', conf: x }
  const y = scoreY(g)
  if (y) return { text: 'y', conf: y }
  const two = scoreTwo(g)
  if (two) return { text: '2', conf: two }
  const bee = scoreB(g)
  if (bee) return { text: 'b', conf: bee }
  const ay = scoreA(g)
  if (ay) return { text: 'a', conf: ay }
  const paren = scoreParen(g)
  if (paren) return paren
  return { text: '', conf: 0 }
}

function splitArrow(g: Mark[]): { body: Mark[] } | null {
  if (g.length < 2) return null
  const all = boxOf(g.flatMap((m) => m.pts))
  const decorative = g.filter((m) => {
    const thin = m.b.h < all.h * 0.42
    const above = m.b.cy < all.y0 + all.h * 0.4
    const flat = m.b.h < m.b.w * 0.55 && m.b.w > all.w * 0.35
    const head = m.b.w < all.w * 0.5 && thin
    return thin && above && (flat || head)
  })
  if (!decorative.length) return null
  const body = g.filter((m) => !decorative.includes(m))
  if (!body.length) return null
  const bodyB = boxOf(body.flatMap((m) => m.pts))
  const decB = boxOf(decorative.flatMap((m) => m.pts))
  if (bodyB.y0 - decB.y1 < Math.max(2, bodyB.h * 0.04)) return null
  if (bodyB.h < decB.h * 1.5) return null
  return { body }
}

function scoreEquals(g: Mark[]): number {
  if (g.length !== 2 || !g.every((m) => isHoriz(m.pts))) return 0
  const [top, bot] = [...g].sort((a, b) => a.b.y0 - b.b.y0)
  const overlap = Math.min(top.b.x1, bot.b.x1) - Math.max(top.b.x0, bot.b.x0)
  const minW = Math.min(top.b.w, bot.b.w)
  if (minW < 8 || overlap < minW * 0.6) return 0
  const gap = bot.b.y0 - top.b.y1
  const len = (top.b.w + bot.b.w) / 2
  if (gap < len * 0.04 || gap > len * 0.9) return 0
  if (minW / Math.max(top.b.w, bot.b.w) < 0.55) return 0
  return 0.9
}

function scoreX(g: Mark[]): number {
  if (g.length !== 2) return 0
  const [a, b] = g
  if (straightness(a.pts) < 0.7 || straightness(b.pts) < 0.7) return 0
  const sa = slope(a.pts)
  const sb = slope(b.pts)
  if (sa * sb >= 0) return 0
  if (Math.abs(sa) < 0.35 || Math.abs(sb) < 0.35 || Math.abs(sa) > 3.4 || Math.abs(sb) > 3.4) return 0
  const ae = a.pts[a.pts.length - 1]
  const be = b.pts[b.pts.length - 1]
  if (!properCross(a.pts[0], ae, b.pts[0], be)) return 0
  const bbx = boxOf([...a.pts, ...b.pts])
  if (bbx.h < bbx.w * 0.4 || bbx.w < bbx.h * 0.4) return 0
  return 0.88
}

function scoreY(g: Mark[]): number {
  const pts = g.flatMap((m) => m.pts)
  const b = boxOf(pts)
  if (b.h < 12 || b.w < 8 || b.h < b.w * 0.85) return 0
  const tail = pts.filter((p) => p.y > b.y0 + b.h * 0.62)
  const upper = pts.filter((p) => p.y < b.y0 + b.h * 0.48)
  if (tail.length < 2 || upper.length < 2) return 0
  const tailW = boxOf(tail).w
  const upperW = boxOf(upper).w
  if (upperW < b.w * 0.55 || tailW > upperW * 0.55) return 0
  const mid = (b.x0 + b.x1) / 2
  if (!upper.some((p) => p.x < mid - b.w * 0.12) || !upper.some((p) => p.x > mid + b.w * 0.12)) return 0
  return 0.9
}

function scoreTwo(g: Mark[]): number {
  if (g.length !== 1) return 0
  const pts = g[0].pts
  const b = g[0].b
  if (pts.length < 5 || b.w < 8 || b.h < 8) return 0
  if (b.h / b.w < 0.5 || b.w / b.h < 0.4) return 0
  if (pts[0].y > b.y0 + b.h * 0.4 || pts[pts.length - 1].y < b.y0 + b.h * 0.6) return 0
  const cum = arc(pts)
  const total = cum[cum.length - 1]
  if (total < 10) return 0
  const dx = (from: number, to: number) => {
    let x0 = 0
    let x1 = 0
    let seen = false
    for (let i = 0; i < pts.length; i++) {
      const t = cum[i] / total
      if (t < from || t > to) continue
      if (!seen) {
        x0 = pts[i].x
        seen = true
      }
      x1 = pts[i].x
    }
    return seen ? x1 - x0 : 0
  }
  if (dx(0, 0.4) <= b.w * 0.12) return 0
  if (dx(0.28, 0.75) >= -b.w * 0.08) return 0
  if (dx(0.6, 1) <= b.w * 0.08) return 0
  return 0.82
}

function scoreB(g: Mark[]): number {
  const pts = g.flatMap((m) => m.pts)
  const b = boxOf(pts)
  if (b.h < b.w * 1.12 || b.h < 16 || scoreY(g)) return 0
  const left = pts.filter((p) => p.x <= b.x0 + b.w * 0.4)
  if (left.length < 2 || boxOf(left).h < b.h * 0.7) return 0
  if (pts.filter((p) => p.x >= b.x0 + b.w * 0.42).length < 4) return 0
  return 0.8
}

function scoreA(g: Mark[]): number {
  const pts = g.flatMap((m) => m.pts)
  const b = boxOf(pts)
  if (b.w < 8 || b.h < 8 || b.h > b.w * 1.55 || scoreY(g) || scoreB(g)) return 0
  return loopScore(pts) >= 0.65 ? 0.78 : 0
}

function scoreParen(g: Mark[]): Token | null {
  if (g.length !== 1 || scoreY(g) || scoreX(g) || scoreTwo(g)) return null
  const pts = g[0].pts
  const b = g[0].b
  if (b.h < Math.max(12, b.w * 1.6)) return null
  const mid = pts[Math.floor((pts.length - 1) / 2)]
  const chordX = (pts[0].x + pts[pts.length - 1].x) / 2
  const bulge = mid.x - chordX
  if (Math.abs(bulge) < Math.max(3, b.w * 0.3)) return null
  return { text: bulge < 0 ? '(' : ')', conf: 0.72 }
}

function loopScore(pts: Pt[]): number {
  if (pts.length < 8) return 0
  const b = boxOf(pts)
  const scale = Math.max(b.w, b.h, 1)
  const ends = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y)
  return ends < scale * 0.35 ? 0.8 : 0
}

function joinTokens(tokens: Token[]): InkCandidate | null {
  if (!tokens.length || tokens.some((t) => !t.text)) return null
  let text = ''
  for (const token of tokens) {
    if (token.text === '=') text += ' = '
    else if (token.text === ',') text += ', '
    else if (token.text === '(') text += ' ('
    else text += token.text
  }
  text = text.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()
  // A bare "=" is not a formula, and the parser throws on it. Ask for a letter or a digit.
  if (!text || !/[a-z0-9\\()]/.test(text)) return null
  const confidence = tokens.reduce((m, t) => Math.min(m, t.conf), 1)
  return { text, confidence }
}

function isComponentTuple(text: string): boolean {
  return /=\s*\(/.test(text)
}

function demoteHeavy(strokes: Stroke[], c: InkCandidate): InkCandidate {
  const heavy = /[\^△]|sin|cos|sqrt|mathbf|𝐚/.test(c.text)
  if (heavy && strokes.length < 8) return { ...c, confidence: Math.min(c.confidence, 0.3) }
  return c
}

function dedupe(cands: InkCandidate[]): InkCandidate[] {
  const seen = new Set<string>()
  const out: InkCandidate[] = []
  for (const c of cands) {
    if (seen.has(c.text)) continue
    seen.add(c.text)
    out.push(c)
  }
  return out
}

function boxOf(pts: Pt[]): Box {
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
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0, cy: 0 }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cy: (y0 + y1) / 2 }
}

function xOverlap(a: Box, b: Box): number {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  if (overlap <= 0) return 0
  return overlap / Math.max(1, Math.min(a.w, b.w))
}

function minX(g: Mark[]): number {
  return Math.min(...g.map((m) => m.b.x0))
}

function isHoriz(pts: Pt[]): boolean {
  const b = boxOf(pts)
  return b.w >= 8 && b.h < b.w * 0.36
}

function straightness(pts: Pt[]): number {
  if (pts.length < 2) return 0
  const chord = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y)
  const len = arc(pts)[pts.length - 1]
  return len < 1 ? 0 : chord / len
}

function slope(pts: Pt[]): number {
  const dx = pts[pts.length - 1].x - pts[0].x
  const dy = pts[pts.length - 1].y - pts[0].y
  if (Math.abs(dx) < 1) return dx >= 0 ? 1e6 : -1e6
  return dy / dx
}

function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function arc(pts: Pt[]): number[] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  return cum
}
