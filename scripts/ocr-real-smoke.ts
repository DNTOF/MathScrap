/**
 * Gate checks plus a few real CoMER INT8 readings.
 * Strokes are synthetic polylines, not scanned handwriting.
 * Numbers below are model confidence, not an accuracy rate.
 * The repo has no redistributable scan of a person's handwriting.
 * Missing model files fail this script. They are not a pass.
 *
 *   npx tsx scripts/ocr-real-smoke.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyInk } from '../src/ocr/gate.ts'
import { inkFixtures, isolatedSigma, pointPair, proseNote, proseParagraph, proseWord, sumGlyph } from '../src/ocr/comer/samples.ts'
import { recognizeStrokes } from '../src/ocr/comer/engine.ts'
import { vocabFromJson } from '../src/ocr/comer/source.ts'
import type { ComerSession, ComerTensor } from '../src/ocr/comer/decode.ts'
import { OCR_ACCEPT } from '../src/ocr/threshold.ts'

const modelDir = 'public/models/comer'
const pins = JSON.parse(readFileSync('scripts/ocr-model-pins.json', 'utf8')) as Record<string, string>
for (const [name, want] of Object.entries(pins)) {
  const file = path.join(modelDir, name)
  if (!existsSync(file)) throw new Error(`real OCR model missing: ${name}`)
  const got = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (got !== want) throw new Error(`OCR model hash mismatch: ${name}`)
}

const prose = proseNote()
assert.equal(classifyInk(prose), 'text', 'a baseline of letter-sized marks is not sent as a formula; the gate does not read Chinese or English')
assert.equal(classifyInk(proseWord()), 'text')
assert.equal(classifyInk(proseParagraph()), 'text')
assert.equal(classifyInk([]), 'formula', 'blank ink is not classified as prose')
const fixtures = inkFixtures(3)
for (const name of ['y-eq-2', 'y-eq-x', 'frac', 'a2-eq-b']) {
  const sample = fixtures.find((item) => item.name === name)
  assert.ok(sample, name)
  assert.equal(classifyInk(sample.strokes), 'formula', `${name} is formula-like`)
}
const blank = await recognizeStrokes([], boom(), boom(), vocabPlaceholder(), 1)
assert.deepEqual(blank, [])
const noise = await recognizeStrokes(
  [{ points: [{ x: 1, y: 1, t: 0 }, { x: 1.2, y: 1.1, t: 1 }] }],
  boom(),
  boom(),
  vocabPlaceholder(),
  1,
)
assert.deepEqual(noise, [])
await assert.rejects(
  () => recognizeStrokes(fixtures[0]!.strokes, failing('model failed'), failing('model failed'), vocabPlaceholder(), 1),
  /model failed/,
)

const ort = await import('onnxruntime-web/wasm')
ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true
ort.env.wasm.wasmPaths = pathToFileURL(`${path.resolve('node_modules/onnxruntime-web/dist')}/`).href
const vocab = vocabFromJson(JSON.parse(readFileSync(path.join(modelDir, 'vocab.json'), 'utf8')))
const opts = { executionProviders: ['wasm' as const] }
const [encoder, decoder] = await Promise.all([
  ort.InferenceSession.create(readFileSync(path.join(modelDir, 'encoder_int8.onnx')), opts).then(wrap),
  ort.InferenceSession.create(readFileSync(path.join(modelDir, 'decoder_int8.onnx')), opts).then(wrap),
])

let ran = 0
for (const name of ['y-eq-2', 'y-eq-x', 'frac', 'a2-eq-b']) {
  const sample = fixtures.find((item) => item.name === name)!
  const hits = await recognizeStrokes(sample.strokes, encoder, decoder, vocab, 1)
  const top = hits[0]?.text ?? ''
  console.log(`synthetic ${name}: ${top || '(empty)'} conf=${hits[0]?.confidence ?? 0}`)
  const expect = name === 'y-eq-x' ? /^[yY] = [xX]$/ : sample.expect
  assert.match(top, expect, `${name} real model`)
  assert.ok((hits[0]?.confidence ?? 0) >= OCR_ACCEPT, `${name} below ${OCR_ACCEPT}`)
  assert.ok(!/1,\s*2,\s*2/.test(top), `${name} invented a triple`)
  ran += 1
}
const sumHits = await recognizeStrokes(sumGlyph(), encoder, decoder, vocab, 2)
console.log('synthetic sum', sumHits.map((h) => `${h.text} (${h.confidence.toFixed(2)})`).join(' | ') || '(empty)')
assert.match(sumHits[0]?.text ?? '', /^\\sum(?![A-Za-z])/)
const sigmaHits = await recognizeStrokes(isolatedSigma(), encoder, decoder, vocab, 2)
console.log('synthetic sigma', sigmaHits.map((h) => `${h.text} (${h.confidence.toFixed(2)})`).join(' | ') || '(empty)')
assert.equal(sigmaHits[0]?.text, 'sigma')
const pointHits = await recognizeStrokes(pointPair(), encoder, decoder, vocab, 2)
console.log('synthetic point', pointHits.map((h) => `${h.text} (${h.confidence.toFixed(2)})`).join(' | ') || '(empty)')
assert.match(pointHits[0]?.text ?? '', /^A\(2, 2\)$/)
assert.equal(ran, 4)
console.log('ocr-real-smoke ok (synthetic strokes; confidence is not accuracy; no handwriting scan in the repo)')

function boom(): ComerSession {
  return { async run() { throw new Error('blank or noise must not call the model') } }
}
function failing(message: string): ComerSession {
  return { async run() { throw new Error(message) } }
}
function vocabPlaceholder() {
  return vocabFromJson({ idx2word: { '3': 'y' }, special_tokens: { sos: 1, eos: 2, pad: 0 }, vocab_size: 4 })
}

function copyData(data: ArrayBufferView): Float32Array | Uint8Array | BigInt64Array {
  if (data instanceof Float32Array) return Float32Array.from(data)
  if (data instanceof BigInt64Array) return BigInt64Array.from(data)
  if (data instanceof Uint8Array) return Uint8Array.from(data)
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

function wrap(session: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: ArrayBufferView; dims: readonly number[]; dispose?: () => void }>> }): ComerSession {
  return {
    async run(feeds) {
      const mapped: Record<string, { dispose?: () => void }> = {}
      for (const [name, tensor] of Object.entries(feeds)) {
        mapped[name] = new ort.Tensor(tensor.type, tensor.data as never, tensor.dims)
      }
      const out = await session.run(mapped)
      for (const value of Object.values(mapped)) value.dispose?.()
      const result: Record<string, ComerTensor> = {}
      for (const [name, tensor] of Object.entries(out)) {
        const data = copyData(tensor.data)
        result[name] = {
          type: data instanceof Float32Array ? 'float32' : data instanceof BigInt64Array ? 'int64' : 'bool',
          data,
          dims: [...tensor.dims],
          dispose: () => tensor.dispose?.(),
        }
      }
      return result
    },
  }
}
