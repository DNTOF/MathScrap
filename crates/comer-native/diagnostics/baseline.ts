/**
 * Baseline capture for the comer-native Rust port (round 1 parity).
 *
 *   npx tsx crates/comer-native/diagnostics/baseline.ts
 *
 * Runs the same fixtures as `npm run ocr:live` through onnxruntime-web (SIMD,
 * numThreads=1), records decode-level results (latex tokens + model confidence
 * BEFORE bind/sigma/agree post-processing — the surface the Rust port must
 * match) and preprocess checksums, and writes crates/comer-native/fixtures/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ComerTensor } from '../../../src/ocr/comer/decode.ts'
import { decodeComer } from '../../../src/ocr/comer/decode.ts'
import { recognizeStrokes } from '../../../src/ocr/comer/engine.ts'
import { preprocessStrokes } from '../../../src/ocr/comer/preprocess.ts'
import { arrowLetter, inkFixtures, isolatedSigma, pointPair, sumBar, sumGlyph } from '../../../src/ocr/comer/samples.ts'
import { decodeTokens, vocabFromJson, type Vocab } from '../../../src/ocr/comer/source.ts'

const ort = await import('onnxruntime-web/wasm')
ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true
ort.env.wasm.wasmPaths = pathToFileURL(`${path.resolve('node_modules/onnxruntime-web/dist')}/`).href
console.log(`baseline runtime: onnxruntime-web ${ort.env.versions?.web ?? '?'}, wasm SIMD, numThreads=1`)

const vocab: Vocab = vocabFromJson(JSON.parse(readFileSync('public/models/comer/vocab.json', 'utf8')))
const opts = { executionProviders: ['wasm' as const] }

function copyData(data: ArrayBufferView): Float32Array | Uint8Array | BigInt64Array {
  if (data instanceof Float32Array) return Float32Array.from(data)
  if (data instanceof BigInt64Array) return BigInt64Array.from(data)
  if (data instanceof Uint8Array) return Uint8Array.from(data)
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

function wrap(session: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: ArrayBufferView; dims: readonly number[]; dispose?: () => void }>> }) {
  return {
    async run(feeds: Record<string, ComerTensor>) {
      const mapped: Record<string, unknown> = {}
      for (const [name, tensor] of Object.entries(feeds)) mapped[name] = new ort.Tensor(tensor.type, tensor.data as never, tensor.dims)
      const out = await session.run(mapped)
      for (const value of Object.values(mapped)) (value as { dispose?: () => void }).dispose?.()
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

const encoder = wrap(await ort.InferenceSession.create(readFileSync('public/models/comer/encoder_int8.onnx'), opts))
const decoder = wrap(await ort.InferenceSession.create(readFileSync('public/models/comer/decoder_int8.onnx'), opts))

const samples = [
  ...inkFixtures(3).map((f) => ({ name: `${f.name}-w3`, strokes: f.strokes })),
  ...inkFixtures(5).map((f) => ({ name: `${f.name}-w5`, strokes: f.strokes })),
  { name: 'arrow-w3', strokes: arrowLetter() },
  { name: 'sum-w3', strokes: sumGlyph() },
  { name: 'sum-bar-w3', strokes: sumBar() },
  { name: 'sigma-w3', strokes: isolatedSigma() },
  { name: 'point-w3', strokes: pointPair() },
]

const FULL_TENSOR_FOR = new Set(['frac-w3', 'sigma-w3'])
const fixtures: unknown[] = []

for (const sample of samples) {
  const image = preprocessStrokes(sample.strokes)
  let sum = 0
  let absSum = 0
  for (let i = 0; i < image.tensor.length; i++) {
    sum += image.tensor[i]
    absSum += Math.abs(image.tensor[i])
  }
  let maskSum = 0
  for (let i = 0; i < image.mask.length; i++) maskSum += image.mask[i]

  const t0 = Date.now()
  const hits = await decodeComer(encoder, decoder, { type: 'float32', data: image.tensor, dims: [1, 1, image.height, image.width] }, { type: 'bool', data: image.mask, dims: [1, image.maskHeight, image.maskWidth] }, {
    sos: vocab.special_tokens.sos,
    eos: vocab.special_tokens.eos,
    vocabSize: vocab.vocab_size,
    beamWidth: 2,
    maxSteps: 40,
  })
  const decodeMs = Date.now() - t0
  const expected = hits.map((h) => ({
    latex: decodeTokens(h.ids, vocab).join(' '),
    conf: Math.exp(h.logProb / Math.max(1, h.ids.length)),
  }))
  const t1 = Date.now()
  const cands = await recognizeStrokes(sample.strokes, encoder, decoder, vocab, 2)
  const fullMs = Date.now() - t1
  console.log(
    `${sample.name.padEnd(12)} dims=${image.width}x${image.height} decode=${decodeMs}ms full=${fullMs}ms`,
    `latex="${expected[0]?.latex ?? ''}" (${expected[0]?.conf?.toFixed(3) ?? '-'})`,
    `text="${cands[0]?.text ?? ''}" (${cands[0]?.confidence?.toFixed(2) ?? '-'})`,
  )

  const fixture: Record<string, unknown> = {
    name: sample.name,
    strokes: sample.strokes,
    dims: { height: image.height, width: image.width },
    tensorSum: sum,
    tensorAbsSum: absSum,
    maskSum,
    expected,
    text: cands.map((c) => ({ text: c.text, confidence: c.confidence })),
  }
  if (FULL_TENSOR_FOR.has(sample.name)) fixture.tensor = Array.from(image.tensor, (v) => Number(v.toFixed(6)))
  fixtures.push(fixture)
}

mkdirSync('crates/comer-native/fixtures', { recursive: true })
writeFileSync('crates/comer-native/fixtures/fixtures.json', JSON.stringify({ runtime: `onnxruntime-web ${ort.env.versions?.web ?? '?'}`, vocabSize: vocab.vocab_size, fixtures }, null, 1))
console.log(`wrote ${fixtures.length} fixtures → crates/comer-native/fixtures/fixtures.json`)
