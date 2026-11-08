/**
 * Gate checks plus a few real CoMER INT8 readings.
 * Strokes are synthetic polylines, not scanned handwriting.
 * Missing model files fail this script. They are not a pass.
 *
 *   npx tsx scripts/ocr-real-smoke.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyInk } from '../src/ocr/gate.ts'
import { inkFixtures, proseNote } from '../src/ocr/comer/samples.ts'
import { recognizeStrokes } from '../src/ocr/comer/engine.ts'
import { vocabFromJson } from '../src/ocr/comer/source.ts'
import type { ComerSession, ComerTensor } from '../src/ocr/comer/decode.ts'

const modelDir = 'public/models/comer'
const needed = ['encoder_int8.onnx', 'decoder_int8.onnx', 'vocab.json']
for (const name of needed) {
  if (!existsSync(path.join(modelDir, name))) {
    throw new Error(`real OCR model missing: ${name}`)
  }
}

assert.equal(classifyInk(proseNote()), 'text', 'synthetic prose stays out of the formula model')
assert.equal(classifyInk([]), 'formula', 'blank ink is not prose; the caller still sends nothing')
const fixtures = inkFixtures(3)
for (const name of ['y-eq-2', 'frac', 'a2-eq-b']) {
  const sample = fixtures.find((item) => item.name === name)
  assert.ok(sample, name)
  assert.equal(classifyInk(sample.strokes), 'formula', `${name} is formula-like`)
}

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
for (const name of ['y-eq-2', 'frac']) {
  const sample = fixtures.find((item) => item.name === name)!
  const hits = await recognizeStrokes(sample.strokes, encoder, decoder, vocab, 1)
  const top = hits[0]?.text ?? ''
  console.log(`synthetic ${name}: ${top || '(empty)'}`)
  assert.match(top, sample.expect, `${name} real model`)
  assert.ok(!/1,\s*2,\s*2/.test(top), `${name} invented a triple`)
  ran += 1
}
assert.equal(ran, 2)
console.log('ocr-real-smoke ok (synthetic strokes, not a handwriting accuracy claim)')

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
