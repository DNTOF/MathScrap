/**
 * Local check of the vendored CoMER INT8 models (not part of smoke:ocr).
 *
 *   npm run ocr:live
 *
 * Writes the raster the model sees to /tmp/mathscrap-ocr/*.png and prints LaTeX.
 * ONNX Runtime Web WASM is loaded from node_modules. The browser chip calls the
 * same preprocessStrokes + recognizeStrokes path.
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import type { ComerSession, ComerTensor } from '../src/ocr/comer/decode.ts'
import { recognizeStrokes } from '../src/ocr/comer/engine.ts'
import { preprocessStrokes } from '../src/ocr/comer/preprocess.ts'
import { inkFixtures } from '../src/ocr/comer/samples.ts'
import { vocabFromJson } from '../src/ocr/comer/source.ts'

const ort = await import('onnxruntime-web/wasm')
const dist = path.resolve('node_modules/onnxruntime-web/dist')
ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true
ort.env.wasm.wasmPaths = pathToFileURL(`${dist}/`).href

const vocab = vocabFromJson(JSON.parse(readFileSync('public/models/comer/vocab.json', 'utf8')))
const opts = { executionProviders: ['wasm' as const] }
const [encoder, decoder] = await Promise.all([
  ort.InferenceSession.create(readFileSync('public/models/comer/encoder_int8.onnx'), opts).then(wrap),
  ort.InferenceSession.create(readFileSync('public/models/comer/decoder_int8.onnx'), opts).then(wrap),
])

const outDir = '/tmp/mathscrap-ocr'
mkdirSync(outDir, { recursive: true })

for (const width of [3, 5]) {
  for (const sample of inkFixtures(width)) {
    const image = preprocessStrokes(sample.strokes)
    const tag = `${sample.name}-w${width}`
    savePng(tag, image.tensor, image.width, image.height)
    const t0 = Date.now()
    const hits = await recognizeStrokes(sample.strokes, encoder, decoder, vocab, 2)
    const top = hits[0]?.text ?? ''
    console.log(tag, `${Date.now() - t0}ms`, hits.map((h) => `${h.text} (${h.confidence.toFixed(2)})`).join(' | ') || '(empty)')
    assert.ok(!hits.some((h) => /1,\s*2,\s*2/.test(h.text) || h.text.includes('𝐚')), `${tag} invented a vector triple`)
    if (width === 3) assert.match(top, sample.expect, `${tag} top candidate`)
    else assert.match(top, loose(sample.name), `${tag} top candidate`)
  }
}

console.log('ocr live ok')

function loose(name: string) {
  if (name === 'y-eq-2') return /^[yY] = 2$/
  if (name === 'y-eq-x') return /^[yY] = [xX]$/
  if (name === 'a2-eq-b') return /^a\^2 = b/
  return /^\(1\)\/\(2\)$/
}

function savePng(name: string, tensor: Float32Array, width: number, height: number) {
  const png = new PNG({ width, height })
  for (let i = 0; i < tensor.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(tensor[i] * 255)))
    png.data[i * 4] = v
    png.data[i * 4 + 1] = v
    png.data[i * 4 + 2] = v
    png.data[i * 4 + 3] = 255
  }
  writeFileSync(path.join(outDir, `${name}.png`), PNG.sync.write(png))
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
