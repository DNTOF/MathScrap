/**
 * Handwriting geometry: a large `y = x` must not become the vector triple the old
 * aspect-ratio stub always offered at 62%.
 *
 *   npm run smoke:ocr
 */
import assert from 'node:assert/strict'
import type { Stroke } from '../src/board/types.ts'
import { filterAbsurd, hasParenGeometry, recognizeInk } from '../src/ocr/inkShape.ts'

function aspectOf(strokes: Stroke[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes) {
    for (let i = 0; i + 1 < s.pts.length; i += 3) {
      x0 = Math.min(x0, s.pts[i])
      y0 = Math.min(y0, s.pts[i + 1])
      x1 = Math.max(x1, s.pts[i])
      y1 = Math.max(y1, s.pts[i + 1])
    }
  }
  return (x1 - x0) / Math.max(1, y1 - y0)
}

function ink(paths: number[][][]): Stroke[] {
  return paths.map((pts, i) => ({
    id: `s${i}`,
    pts: pts.flatMap(([x, y]) => [x, y, 0.5]),
    color: '#2b2118',
    width: 3,
    style: 'ink' as const,
    createdAt: i,
  }))
}

function circle(cx: number, cy: number, r: number, n = 16): number[][] {
  const pts: number[][] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
  }
  return pts
}

/** One-stroke y, two-bar equals, two-stroke x. Aspect sits in the old bug window. */
function yEqualsX(): Stroke[] {
  return ink([
    [
      [8, 10],
      [20, 34],
      [32, 12],
      [34, 48],
      [36, 78],
      [37, 96],
    ],
    [
      [58, 36],
      [96, 38],
    ],
    [
      [58, 54],
      [96, 52],
    ],
    [
      [112, 18],
      [150, 58],
    ],
    [
      [150, 20],
      [112, 56],
    ],
  ])
}

function yEquals2x(): Stroke[] {
  return ink([
    [
      [8, 10],
      [20, 34],
      [32, 12],
      [34, 48],
      [36, 78],
      [37, 96],
    ],
    [
      [58, 36],
      [96, 38],
    ],
    [
      [58, 54],
      [96, 52],
    ],
    [
      [112, 14],
      [140, 12],
      [144, 26],
      [122, 42],
      [112, 56],
      [146, 58],
    ],
    [
      [160, 16],
      [196, 58],
    ],
    [
      [196, 18],
      [160, 56],
    ],
  ])
}

function aEqualsB(): Stroke[] {
  return ink([
    circle(40, 50, 18),
    [
      [78, 40],
      [112, 42],
    ],
    [
      [78, 58],
      [112, 56],
    ],
    [
      [132, 8],
      [134, 78],
    ],
    circle(148, 58, 16),
  ])
}

function arrowedA(): Stroke[] {
  return ink([
    [
      [22, 12],
      [58, 14],
    ],
    [
      [58, 14],
      [48, 6],
    ],
    [
      [58, 14],
      [48, 22],
    ],
    circle(40, 58, 18),
  ])
}

/** The two wide strokes the sheet e2e draws. Must not come back as a vector triple. */
function e2eScribble(): Stroke[] {
  return ink([
    [
      [320, 320],
      [430, 300],
      [540, 330],
    ],
    [
      [330, 370],
      [540, 355],
    ],
  ])
}

function assertNoTuple(cands: { text: string; confidence: number }[], where: string) {
  for (const c of cands) {
    assert.ok(!/=\s*\(/.test(c.text), `${where}: invented tuple ${c.text}`)
    assert.ok(!c.text.includes('𝐚'), `${where}: bold vector ${c.text}`)
    assert.ok(!/1,\s*2,\s*2/.test(c.text), `${where}: sample vector ${c.text}`)
  }
}

const yx = yEqualsX()
const aspect = aspectOf(yx)
assert.ok(aspect > 1.5 && aspect < 2.2, `fixture should sit in the old bug aspect window, got ${aspect.toFixed(2)}`)

const yxRead = recognizeInk(yx)
assert.equal(yxRead[0]?.text, 'y = x', JSON.stringify(yxRead))
assert.ok((yxRead[0]?.confidence ?? 0) >= 0.6, `confidence ${yxRead[0]?.confidence}`)
assertNoTuple(yxRead, 'y = x')

const twoStrokeY = recognizeInk(
  ink([
    [
      [8, 12],
      [24, 40],
      [40, 12],
    ],
    [
      [40, 12],
      [42, 50],
      [44, 96],
    ],
    [
      [58, 36],
      [96, 38],
    ],
    [
      [58, 54],
      [96, 52],
    ],
    [
      [112, 18],
      [150, 58],
    ],
    [
      [150, 20],
      [112, 56],
    ],
  ]),
)
assert.equal(twoStrokeY[0]?.text, 'y = x', JSON.stringify(twoStrokeY))
assertNoTuple(twoStrokeY, 'two-stroke y')

const y2 = recognizeInk(yEquals2x())
assert.equal(y2[0]?.text, 'y = 2x', JSON.stringify(y2))
assertNoTuple(y2, 'y = 2x')

const ab = recognizeInk(aEqualsB())
assert.equal(ab[0]?.text, 'a = b', JSON.stringify(ab))
assertNoTuple(ab, 'a = b')

const vec = recognizeInk(arrowedA())
assert.equal(vec[0]?.text, '\\vec{a}', JSON.stringify(vec))
assertNoTuple(vec, 'arrowed a')

const poisoned = filterAbsurd(yx, [{ text: '𝐚 = (1, 2, 2)', confidence: 0.9 }])
assert.ok(!poisoned.some((c) => /=\s*\(/.test(c.text) && c.confidence >= 0.5), JSON.stringify(poisoned))
assert.equal(hasParenGeometry(yx), false)

const paren = ink([
  [
    [10, 8],
    [2, 28],
    [0, 48],
    [2, 68],
    [10, 88],
  ],
])
assert.equal(hasParenGeometry(paren), true)
const kept = filterAbsurd(paren, [{ text: 'a = (1, 2)', confidence: 0.7 }])
assert.equal(kept[0]?.text, 'a = (1, 2)')

const scribble = recognizeInk(e2eScribble())
assert.ok(scribble.length > 0, 'e2e ink still yields a candidate')
assertNoTuple(scribble, 'e2e scribble')
assert.ok((scribble[0]?.confidence ?? 1) < 0.45, 'unrelated ink must not look sure')

console.log('ocr smoke ok', { aspect: aspect.toFixed(2), yx: yxRead[0], y2: y2[0], ab: ab[0], vec: vec[0], scribble: scribble[0] })
