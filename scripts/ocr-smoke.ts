/**
 * Handwriting checks.
 *
 * Geometry (`inkShape`) stays as a regression for the old reader: a large `y = x`
 * must not become the vector triple the aspect-ratio stub offered at 62%.
 * The chip does not call that reader. The CoMER path is the mock session below:
 * preprocess shape, token cleanup, and a scripted encoder/decoder. The real ONNX
 * files are exercised with `npm run ocr:live`.
 *
 *   npm run smoke:ocr
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Stroke } from '../src/board/types.ts'
import type { ComerSession, ComerTensor } from '../src/ocr/comer/decode.ts'
import { bindInk, findOverArrow } from '../src/ocr/comer/bind.ts'
import { classifyInk, looksLikeIsolatedSigma } from '../src/ocr/gate.ts'
import { agreeConfidence, recognizeStrokes } from '../src/ocr/comer/engine.ts'
import { OCR_ACCEPT } from '../src/ocr/threshold.ts'
import { isInkMeaningful, preprocessStrokes, resamplePoints, type InkStroke } from '../src/ocr/comer/preprocess.ts'
import { arrowLetter, bowlU, closedZero, forkY, inkFixtures, isolatedSigma, proseNote, sigmaHook, sigmaLoop, sumBar, sumGlyph } from '../src/ocr/comer/samples.ts'
import { looksLikeIsolatedSigma as sigmaGlyph, repairIsolatedSigma } from '../src/ocr/comer/sigma.ts'
import { tokensToSource, vocabFromJson } from '../src/ocr/comer/source.ts'
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
/** Letter a, a small 2 on its top-right shoulder (x-overlap so they merge), equals, b. */
function aPower2EqualsB(): Stroke[] {
  return ink([
    circle(36, 64, 22),
    [
      [46, 16],
      [70, 14],
      [74, 26],
      [54, 38],
      [46, 46],
      [72, 48],
    ],
    [
      [100, 52],
      [138, 54],
    ],
    [
      [100, 70],
      [138, 68],
    ],
    [
      [156, 18],
      [158, 96],
    ],
    circle(176, 74, 18),
  ])
}

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
      [42, 40],
      [43, 68],
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

const powered = recognizeInk(aPower2EqualsB())
assert.equal(powered[0]?.text, 'a^2 = b', JSON.stringify(powered))
assert.ok((powered[0]?.confidence ?? 0) >= 0.6, `a^2 confidence ${powered[0]?.confidence}`)
assertNoTuple(powered, 'a^2 = b')

const scribble = recognizeInk(e2eScribble())
assert.ok(!scribble.some((c) => c.text.replace(/\s/g, '') === 'y=x'), `junk must not default to y = x (${JSON.stringify(scribble)})`)
assert.equal(scribble.length, 0, JSON.stringify(scribble))

console.log('ocr geometry ok', { aspect: aspect.toFixed(2), yx: yxRead[0], y2: y2[0], ab: ab[0], vec: vec[0], powered: powered[0], scribble })

const vocab = vocabFromJson(JSON.parse(readFileSync('public/models/comer/vocab.json', 'utf8')))
const eos = vocab.special_tokens.eos
assert.equal(vocab.special_tokens.sos, 1)
assert.equal(eos, 2)
const id = (word: string) => {
  const n = vocab.word2idx[word]
  assert.equal(typeof n, 'number', word)
  return n
}

assert.equal(tokensToSource(['y', '=', '2']), 'y = 2')
assert.equal(tokensToSource(['a', '^', '{', '2', '}', '=', 'b']), 'a^2 = b')
assert.equal(tokensToSource(['\\frac', '{', 'a', '}', '{', 'b', '}']), '(a)/(b)')
assert.equal(tokensToSource(['\\sqrt', '{', 'x', '}']), 'sqrt(x)')
assert.equal(tokensToSource(['\\vec', '{', 'a', '}']), '\\vec{a}')
assert.equal(tokensToSource(['\\sum', '_', '{', 'i', '=', '1', '}', '^', '{', 'n', '}', 'i']), '\\sum_{i = 1}^{n} i')
assert.equal(tokensToSource(['y', '=', '\\sum', '_', '{', 'k', '=', '1', '}', '^', '{', 'n', '}', 'k']), 'y = \\sum_{k = 1}^{n} k')
assert.equal(tokensToSource(['\\sum', 'i']), '\\sum i')
assert.equal(tokensToSource(['\\sum', '\\limits', '_', '{', 'L', '-', '1', '}', '^', '{', 'r', '}']), '\\sum_{L - 1}^{r}')
assert.equal(tokensToSource(['\\int', '_', '{', '0', '}', '^', '{', '1', '}', 'x']), '\\int_{0}^{1} x')
assert.equal(tokensToSource(['\\sigma']), 'sigma')
assert.equal(tokensToSource(['\\pi']), 'pi')
assert.equal(tokensToSource(['\\theta']), 'theta')
assert.equal(tokensToSource(['y', '=', '\\sigma']), 'y = sigma')
assert.equal(tokensToSource(['\\overrightarrow', '{', 'b', '}']), '\\vec{b}')
assert.equal(tokensToSource(['=']), '')
assert.equal(tokensToSource(['\\frac']), '')

const line = resamplePoints(
  [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
  ],
  10,
)
assert.equal(line[0]?.x, 0)
assert.equal(line[line.length - 1]?.x, 30)
assert.ok(line.length >= 4)

const glyph = [
  {
    points: [
      { x: 0, y: 0 },
      { x: 12, y: 40 },
      { x: 30, y: 8 },
      { x: 28, y: 70 },
      { x: 70, y: 30 },
      { x: 96, y: 64 },
    ],
    lineWidth: 3,
  },
]
const image = preprocessStrokes(glyph)
assert.equal(image.height, 256)
assert.equal(image.width % 64, 0)
assert.ok(image.width >= 128 && image.width <= 1024)
assert.equal(image.tensor.length, image.height * image.width)
assert.equal(image.mask.length, image.tensor.length)
assert.ok(image.tensor.some((v) => v > 0.5), 'white ink')
assert.ok(image.mask.includes(0) && image.mask.includes(1))
assert.equal(isInkMeaningful([{ points: [{ x: 0, y: 0 }, { x: 2, y: 1 }], lineWidth: 3 }]), false)

function logitFor(p: number) {
  const rest = vocab.vocab_size - 1
  return Math.log((p / (1 - p)) * rest)
}

function scripted(tokens: number[], logit = 6): ComerSession {
  return {
    async run(feeds): Promise<Record<string, ComerTensor>> {
      if (feeds.pixel_values) {
        return {
          encoder_features: { type: 'float32', data: new Float32Array(4), dims: [1, 1, 4] },
          encoder_mask: { type: 'bool', data: new Uint8Array([0]), dims: [1, 1, 1] },
        }
      }
      const ids = feeds.input_ids?.data
      if (!(ids instanceof BigInt64Array)) throw new Error('missing input_ids')
      const want = tokens[ids.length - 1] ?? eos
      const logits = new Float32Array(ids.length * vocab.vocab_size)
      logits[(ids.length - 1) * vocab.vocab_size + want] = logit
      return { logits: { type: 'float32', data: logits, dims: [1, ids.length, vocab.vocab_size] } }
    },
  }
}

const boom: ComerSession = {
  async run() {
    throw new Error('a speck must not reach the model')
  },
}
assert.deepEqual(await recognizeStrokes([{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], lineWidth: 2 }], boom, boom, vocab), [])

const y2session = scripted([id('y'), id('='), id('2')])
const y2model = await recognizeStrokes(glyph, y2session, y2session, vocab, 1)
assert.equal(y2model[0]?.text, 'y = 2')
assert.ok(!y2model.some((c) => c.text.replace(/\s/g, '') === 'y=x'))
assert.ok((y2model[0]?.confidence ?? 0) > 0.5)

const poweredSession = scripted([id('a'), id('^'), id('{'), id('2'), id('}'), id('='), id('b')])
const poweredModel = await recognizeStrokes(glyph, poweredSession, poweredSession, vocab, 1)
assert.equal(poweredModel[0]?.text, 'a^2 = b')

const fracSession = scripted([id('\\frac'), id('{'), id('1'), id('}'), id('{'), id('2'), id('}')])
const fracModel = await recognizeStrokes(glyph, fracSession, fracSession, vocab, 1)
assert.equal(fracModel[0]?.text, '(1)/(2)')

const emptySession = scripted([])
const emptyModel = await recognizeStrokes(glyph, emptySession, emptySession, vocab, 1)
assert.deepEqual(emptyModel, [])

const yxSession = scripted([id('y'), id('='), id('x')])
const onlyIfScripted = await recognizeStrokes(glyph, yxSession, yxSession, vocab, 1)
assert.equal(onlyIfScripted[0]?.text, 'y = x')

console.log('ocr model path ok', { y2: y2model[0], powered: poweredModel[0], frac: fracModel[0], tensor: `${image.height}x${image.width}` })

function poly(pts: number[][], lineWidth = 3): InkStroke {
  return { points: pts.map(([x, y]) => ({ x, y })), lineWidth }
}

const y2strokes = inkFixtures(3).find((s) => s.name === 'y-eq-2')!.strokes
assert.equal(findOverArrow(y2strokes), null)
assert.equal(bindInk(y2strokes, 'y = 2'), 'y = 2')
assert.equal(bindInk(y2strokes, 'a'), '')
assert.equal(bindInk(y2strokes, 'a = (1, 2, 2)'), '')
assert.equal(bindInk(y2strokes, 'A(1,2)'), 'A(1, 2)')
assert.equal(bindInk(y2strokes, 'a = (2, 3)'), 'A(2, 3)')

const arrowed = [
  poly([
    [16, 24],
    [84, 22],
  ]),
  poly(
    Array.from({ length: 16 }, (_, i) => {
      const t = (i / 15) * Math.PI * 2
      return [48 + 18 * Math.cos(t), 78 + 18 * Math.sin(t)]
    }),
  ),
]
const dir = findOverArrow(arrowed)
assert.ok(dir && dir.x > 0.9 && Math.abs(dir.y) < 0.2, JSON.stringify(dir))
const boundVec = bindInk(arrowed, 'a')
assert.match(boundVec, /^\\vec\{a\} = \([0-9.\-]+, [0-9.\-]+\)$/)
assert.equal(bindInk(arrowed, 'a = (1, 2, 2)'), boundVec)
assert.doesNotMatch(boundVec, /1,\s*2,\s*2/)
assert.equal(bindInk(arrowed, '\\sum'), '\\sum')
assert.equal(bindInk(arrowed, '\\sum_{i = 1}^{n} i'), '\\sum_{i = 1}^{n} i')
assert.equal(bindInk(arrowed, 'y = 2'), 'y = 2')
assert.equal(bindInk(y2strokes, '\\vec{a}'), '')
assert.equal(bindInk(y2strokes, 'b'), '')
assert.equal(bindInk(arrowed, 'sigma'), 'sigma')
assert.equal(bindInk(arrowed, 'pi'), 'pi')
console.log('ocr bind ok', { point: bindInk(y2strokes, 'A(1,2)'), vec: boundVec })

const midVec = '\\vec{a} = (1, 0.02)'
assert.equal(agreeConfidence(arrowed, midVec, 0.48), 0.78)
assert.equal(agreeConfidence(arrowed, midVec, 0.3), 0.3)
assert.equal(agreeConfidence(y2strokes, midVec, 0.9), 0.9)
assert.equal(agreeConfidence(arrowed, 'y = 2', 0.48), 0.48)
assert.equal(agreeConfidence(arrowed, '\\sum', 0.45), 0.78)
assert.equal(agreeConfidence(arrowed, '\\sum_{i = 1}^{n} i', 0.45), 0.78)
assert.equal(agreeConfidence(arrowed, '\\sum', 0.25), 0.25)
assert.equal(agreeConfidence(y2strokes, 'sigma', 0.5), 0.78)
assert.equal(agreeConfidence(y2strokes, 'sigma', 0.3), 0.3)
assert.equal(agreeConfidence(y2strokes, 'a', 0.9), 0.9)
assert.equal(looksLikeIsolatedSigma(isolatedSigma()), true)
assert.equal(looksLikeIsolatedSigma(sumGlyph()), false)
assert.equal(looksLikeIsolatedSigma(sumBar()), false)
assert.equal(looksLikeIsolatedSigma(arrowLetter()), false)
assert.equal(looksLikeIsolatedSigma(y2strokes), false)
assert.equal(agreeConfidence(isolatedSigma(), 'sigma', 0.29), 0.78)
assert.equal(agreeConfidence(isolatedSigma(), 'sigma', 0.2), 0.2)
assert.equal(agreeConfidence(isolatedSigma(), 'theta', 0.29), 0.29)
assert.equal(agreeConfidence(sumGlyph(), 'sigma', 0.29), 0.29)

const weak = logitFor(0.48)
const faint = logitFor(0.3)
const letterA = scripted([id('a')], weak)
const agreed = await recognizeStrokes(arrowed, letterA, letterA, vocab, 1)
assert.match(agreed[0]?.text ?? '', /^\\vec\{a\} = \(/, JSON.stringify(agreed))
assert.ok((agreed[0]?.confidence ?? 0) >= OCR_ACCEPT, `arrow lift ${agreed[0]?.confidence}`)
const faintArrow = await recognizeStrokes(arrowed, scripted([id('a')], faint), scripted([id('a')], faint), vocab, 1)
assert.ok((faintArrow[0]?.confidence ?? 1) < OCR_ACCEPT, `faint arrow must stay ink (${faintArrow[0]?.confidence})`)
const bareLetter = await recognizeStrokes(glyph, scripted([id('a')], 6), scripted([id('a')], 6), vocab, 1)
assert.ok(!bareLetter.some((c) => /\\vec\{|^[A-Z]\(/.test(c.text)), JSON.stringify(bareLetter))
assert.equal(bareLetter.length, 0, JSON.stringify(bareLetter))
const sumToks = ['\\sum', '_', '{', 'i', '=', '1', '}', '^', '{', 'n', '}', 'i'].map(id)
const sumAgreed = await recognizeStrokes(arrowed, scripted(sumToks, weak), scripted(sumToks, weak), vocab, 1)
assert.equal(sumAgreed[0]?.text, '\\sum_{i = 1}^{n} i', JSON.stringify(sumAgreed))
assert.ok((sumAgreed[0]?.confidence ?? 0) >= OCR_ACCEPT, `sum lift ${sumAgreed[0]?.confidence}`)
const sumFaint = await recognizeStrokes(arrowed, scripted(sumToks, faint), scripted(sumToks, faint), vocab, 1)
assert.ok((sumFaint[0]?.confidence ?? 1) < OCR_ACCEPT, `faint sum must stay ink (${sumFaint[0]?.confidence})`)
const sigmaHits = await recognizeStrokes(glyph, scripted([id('\\sigma')], weak), scripted([id('\\sigma')], weak), vocab, 1)
assert.equal(sigmaHits[0]?.text, 'sigma', JSON.stringify(sigmaHits))
assert.ok((sigmaHits[0]?.confidence ?? 0) >= OCR_ACCEPT, `sigma lift ${sigmaHits[0]?.confidence}`)
assert.ok(!/\\vec\{|^[A-Z]\(/.test(sigmaHits[0]?.text ?? ''))
const sigmaFaint = await recognizeStrokes(glyph, scripted([id('\\sigma')], faint), scripted([id('\\sigma')], faint), vocab, 1)
assert.ok((sigmaFaint[0]?.confidence ?? 1) < OCR_ACCEPT, `faint sigma stays ink (${sigmaFaint[0]?.confidence})`)
const plain = await recognizeStrokes(glyph, scripted([id('y'), id('='), id('2')], logitFor(0.5)), scripted([id('y'), id('='), id('2')], logitFor(0.5)), vocab, 1)
assert.equal(plain[0]?.text, 'y = 2')
assert.ok((plain[0]?.confidence ?? 1) < OCR_ACCEPT, `ordinary formula is not lifted (${plain[0]?.confidence})`)
console.log('ocr agreement ok', { arrow: agreed[0], sum: sumAgreed[0], faint: faintArrow[0]?.confidence, plain: plain[0]?.confidence })

const loop = sigmaLoop()
const hook = sigmaHook()
const zero = closedZero()
const bowl = bowlU()
const fork = forkY()
assert.equal(sigmaGlyph(loop), true)
assert.equal(sigmaGlyph(hook), true)
assert.equal(sigmaGlyph(zero), false, 'a closed 0 is not σ')
assert.equal(sigmaGlyph(bowl), false, 'a u bowl is not σ')
assert.equal(sigmaGlyph(fork), false, 'a Y fork is not σ')
assert.equal(sigmaGlyph(proseNote()), false)
assert.equal(sigmaGlyph(y2strokes), false)
assert.equal(repairIsolatedSigma(loop, '0'), 'sigma')
assert.equal(repairIsolatedSigma(loop, 'Y'), 'sigma')
assert.equal(repairIsolatedSigma(hook, 'u'), 'sigma')
assert.equal(repairIsolatedSigma(loop, 'y = 0'), null, 'a formula is not rewritten')
assert.equal(repairIsolatedSigma(zero, '0'), null)
assert.equal(repairIsolatedSigma(bowl, 'u'), null)
assert.equal(repairIsolatedSigma(fork, 'Y'), null)
assert.equal(repairIsolatedSigma(proseNote(), '0'), null)
for (const [ink, token] of [[loop, '0'], [hook, 'u'], [loop, 'Y']] as const) {
  const read = await recognizeStrokes(ink, scripted([id(token)], weak), scripted([id(token)], weak), vocab, 1)
  assert.equal(read[0]?.text, 'sigma', `${token} on σ → ${JSON.stringify(read)}`)
  assert.ok((read[0]?.confidence ?? 0) >= OCR_ACCEPT, `${token} on σ confidence ${read[0]?.confidence}`)
}
const faintZero = await recognizeStrokes(loop, scripted([id('0')], faint), scripted([id('0')], faint), vocab, 1)
assert.notEqual(faintZero[0]?.text, 'sigma', 'a faint 0 is not promoted to σ')
assert.ok((faintZero[0]?.confidence ?? 1) < OCR_ACCEPT)
const realZero = await recognizeStrokes(zero, scripted([id('0')], 6), scripted([id('0')], 6), vocab, 1)
assert.equal(realZero[0]?.text, '0', JSON.stringify(realZero))
const realU = await recognizeStrokes(bowl, scripted([id('u')], 6), scripted([id('u')], 6), vocab, 1)
assert.ok(!realU.some((c) => c.text === 'sigma'), JSON.stringify(realU))
const realY = await recognizeStrokes(fork, scripted([id('Y')], 6), scripted([id('Y')], 6), vocab, 1)
assert.ok(!realY.some((c) => c.text === 'sigma'), JSON.stringify(realY))
const formulaZero = await recognizeStrokes(loop, scripted([id('y'), id('='), id('0')], weak), scripted([id('y'), id('='), id('0')], weak), vocab, 1)
assert.equal(formulaZero[0]?.text, 'y = 0', JSON.stringify(formulaZero))
console.log('ocr sigma glyph ok')

function sumLikeSigma(): InkStroke[] {
  return [
    {
      lineWidth: 3,
      points: [
        { x: 40, y: 8 },
        { x: 12, y: 10 },
        { x: 8, y: 36 },
        { x: 28, y: 52 },
        { x: 8, y: 70 },
        { x: 12, y: 96 },
        { x: 42, y: 98 },
      ],
    },
    { lineWidth: 2, points: [{ x: 48, y: 14 }, { x: 62, y: 12 }] },
    { lineWidth: 2, points: [{ x: 48, y: 92 }, { x: 64, y: 94 }] },
  ]
}

assert.equal(classifyInk(y2strokes), 'formula')
assert.equal(classifyInk(arrowLetter()), 'formula')
assert.equal(classifyInk(proseNote()), 'text', 'a line of letters is not a formula')
assert.equal(classifyInk(sigmaLoop()), 'formula', 'an isolated σ still reaches the model')
assert.equal(classifyInk(closedZero()), 'formula')
assert.equal(classifyInk(sumLikeSigma()), 'formula', 'Σ with limits is a formula')
assert.equal(classifyInk(sumGlyph()), 'formula')
assert.equal(classifyInk(sumBar()), 'formula')
assert.equal(classifyInk(inkFixtures(3).find((s) => s.name === 'frac')!.strokes), 'formula')
console.log('ocr gate ok', { prose: classifyInk(proseNote()), formula: classifyInk(y2strokes) })
