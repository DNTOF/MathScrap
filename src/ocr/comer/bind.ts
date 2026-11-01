import type { InkStroke, StrokePoint } from './preprocess.ts'

/**
 * After CoMER emits LaTeX, attach it to the sheet's point and vector forms.
 * The model stays the reader. This only uses stroke layout to tell an over-arrow
 * from a bare letter, and to keep a coordinate tuple as a point.
 */

export function bindInk(strokes: InkStroke[], modelText: string): string {
  const text = modelText.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const squashed = text.replace(/\s/g, '')
  // ∑, ∫, π, … are not vectors. A bar across the top of Σ must not erase them.
  if (squashed.startsWith('\\') && !/^\\(?:vec|overrightarrow)\b/.test(squashed)) return text
  const arrow = findOverArrow(strokes)
  // Only a letter (or a letter the model already wrapped) sitting under an arrow is `\vec`.
  // `y = 2` keeps its equals. A bare letter with no arrow is left unset below.
  if (arrow && arrowReading(squashed)) {
    const letter = letterOf(text)
    if (!letter) return ''
    const fromInk = tupleOf(text)
    const comps = fromInk && hasParenStroke(strokes) ? fromInk : [fmt(arrow.x), fmt(arrow.y)]
    return `\\vec{${letter}} = (${comps.join(', ')})`
  }
  if (/^\\(?:vec|overrightarrow)\{[A-Za-z]\}$/.test(squashed)) return ''
  const point = pointOf(text, strokes)
  if (point) return point
  if (/^[A-Za-z]$/.test(squashed)) return ''
  // One number in parentheses is not a coordinate point.
  if (/^[A-Za-z]\([+\-0-9.]*\)?$/.test(squashed)) return ''
  if (/^[a-z]\s*=\s*\(/.test(text) && !hasParenStroke(strokes)) return ''
  return text
}

/** A letter, `\vec{a}`, or `a = (1, 2)` — not an equation like `y = 2`. */
function arrowReading(squashed: string): boolean {
  if (/^[A-Za-z]$/.test(squashed)) return true
  if (/^\\(?:vec|overrightarrow)\{[A-Za-z]\}$/.test(squashed)) return true
  if (/^[A-Za-z]\\rightarrow$/.test(squashed)) return true
  return /^[A-Za-z]=\([+\-0-9.]+(?:,[+\-0-9.]+){1,2}\)$/.test(squashed)
}

/** A flat stroke sitting above the rest of the ink, wider than the letter. */
/**
 * ∑ drawn as a top bar, a zigzag, and a bottom bar. The top bar is flat and
 * high, so it used to count as an over-arrow and a letter reading became a vector.
 */
export function looksLikeSumBars(strokes: InkStroke[]): boolean {
  const drawn = strokes.filter((s) => s.points.length >= 2)
  if (drawn.length < 3) return false
  const all = bounds(drawn.flatMap((s) => s.points))
  if (all.h < 24 || all.w < 16) return false
  const flats = drawn.filter((s) => {
    const b = bounds(s.points)
    return b.w > all.w * 0.55 && b.h < Math.max(8, b.w * 0.35)
  })
  if (flats.length < 2) return false
  const boxes = flats.map((s) => bounds(s.points)).sort((a, b) => a.cy - b.cy)
  const top = boxes[0]
  const bot = boxes[boxes.length - 1]
  if (top.cy > all.y0 + all.h * 0.4) return false
  if (bot.cy < all.y0 + all.h * 0.6) return false
  const gap = bot.y0 - top.y1
  if (gap < all.h * 0.35) return false
  const overlap = Math.min(top.x1, bot.x1) - Math.max(top.x0, bot.x0)
  if (overlap < Math.min(top.w, bot.w) * 0.5) return false
  return drawn.some((s) => {
    if (flats.includes(s)) return false
    const b = bounds(s.points)
    return b.h > gap * 0.45 && b.y0 < top.y1 + gap * 0.35 && b.y1 > bot.y0 - gap * 0.35
  })
}

export function findOverArrow(strokes: InkStroke[]): { x: number; y: number } | null {
  if (looksLikeSumBars(strokes)) return null
  const drawn = strokes.filter((s) => s.points.length >= 2)
  if (drawn.length < 2) return null
  const all = bounds(drawn.flatMap((s) => s.points))
  if (all.h < 16 || all.w < 12) return null
  const bars = drawn.filter((s) => {
    const b = bounds(s.points)
    const flat = b.h < Math.max(6, b.w * 0.42) && b.w > all.w * 0.45
    const high = b.cy < all.y0 + all.h * 0.36
    const rest = drawn.filter((o) => o !== s).flatMap((o) => o.points)
    if (rest.length < 2) return false
    const body = bounds(rest)
    const above = b.y1 <= body.y0 + Math.max(3, body.h * 0.12)
    const covers = b.x0 < body.cx && b.x1 > body.cx
    return flat && high && above && covers
  })
  if (bars.length !== 1) return null
  const pts = bars[0].points
  const dx = pts[pts.length - 1].x - pts[0].x
  const dy = pts[0].y - pts[pts.length - 1].y
  const len = Math.hypot(dx, dy)
  if (len < 8) return null
  return { x: dx / len, y: dy / len }
}

function pointOf(text: string, strokes: InkStroke[]): string | null {
  const t = text.replace(/\s/g, '')
  const m = t.match(/^([A-Za-z])(?:=)?\(([+\-0-9.]+),([+\-0-9.]+)(?:,([+\-0-9.]+))?\)$/)
  if (!m) return null
  const coords = [m[2], m[3], m[4]].filter((x): x is string => !!x)
  // A lowercase name plus a 3-number tuple, with no parenthesis drawn, is the old
  // invented vector. A real point is a capital label or a 2-number coordinate.
  const lower = m[1] === m[1].toLowerCase()
  if (coords.length >= 3 && lower && !hasParenStroke(strokes)) return null
  return `${m[1].toUpperCase()}(${coords.join(', ')})`
}

function tupleOf(text: string): string[] | null {
  const m = text.replace(/\s/g, '').match(/\(([+\-0-9.]+),([+\-0-9.]+)(?:,([+\-0-9.]+))?\)$/)
  if (!m) return null
  return [m[1], m[2], m[3]].filter((x): x is string => !!x)
}

function letterOf(text: string): string | null {
  const t = text.replace(/\s/g, '')
  const wrapped = t.match(/^\\(?:vec|overrightarrow)\{([A-Za-z])\}(?:=.*)?$/)
  if (wrapped) return wrapped[1].toLowerCase()
  const arrowTok = t.match(/^([A-Za-z])\\rightarrow$/)
  if (arrowTok) return arrowTok[1].toLowerCase()
  if (/^[A-Za-z]$/.test(t)) return t.toLowerCase()
  const lhs = t.match(/^([A-Za-z])(?:=|\()/)
  if (lhs) return lhs[1].toLowerCase()
  return null
}

function hasParenStroke(strokes: InkStroke[]): boolean {
  return strokes.some((s) => {
    const pts = s.points
    if (pts.length < 4) return false
    const b = bounds(pts)
    if (b.h < Math.max(14, b.w * 1.5)) return false
    const mid = pts[Math.floor(pts.length / 2)]
    const chord = (pts[0].x + pts[pts.length - 1].x) / 2
    return Math.abs(mid.x - chord) > b.w * 0.25
  })
}

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100
  if (Object.is(r, -0) || r === 0) return '0'
  return String(r)
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
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}
