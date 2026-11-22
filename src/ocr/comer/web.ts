import type { Stroke } from '../../board/types.ts'
import { classifyInk } from '../gate.ts'
import { recognizeStrokes, type OcrCandidate } from './engine.ts'
import type { ComerSession, ComerTensor } from './decode.ts'
import { vocabFromJson, type Vocab } from './source.ts'
import type { InkStroke } from './preprocess.ts'
import { assetUrl } from '../../lib/asset.ts'
import { t } from '../../i18n/locale.ts'
import { ocrRuntime } from '../support.ts'

const ENC = assetUrl('models/comer/encoder_int8.onnx')
const DEC = assetUrl('models/comer/decoder_int8.onnx')
// onnxruntime-web 1.18 (non-SIMD fallback) has no Trilu kernel; same weights, Trilu-free causal mask.
const DEC_COMPAT = assetUrl('models/comer/decoder_int8_compat.onnx')
const VOCAB_URL = assetUrl('models/comer/vocab.json')

let pending: Promise<{ encoder: ComerSession; decoder: ComerSession; vocab: Vocab }> | null = null
let chain: Promise<unknown> = Promise.resolve()

/**
 * Browser session. A layout gate runs first: ordinary writing never reaches CoMER.
 * Formula-like ink is fetched into the on-device model. Weights stay on this device.
 */
export function recognizeMath(strokes: Stroke[]): Promise<OcrCandidate[]> {
  const ink = toInk(strokes)
  if (!ink.length || classifyInk(ink) === 'text') return Promise.resolve([])
  const job = chain.then(() => load().then((ready) => recognizeStrokes(ink, ready.encoder, ready.decoder, ready.vocab, 2)))
  chain = job.then(
    () => undefined,
    () => undefined,
  )
  return job
}

function load() {
  pending ??= loadSessions().catch((err) => {
    pending = null
    throw err
  })
  return pending
}

type Ort = typeof import('onnxruntime-web/wasm')

async function loadRuntime(): Promise<{ ort: Ort; decoderUrl: string; sequential: boolean }> {
  const runtime = ocrRuntime()
  if (runtime === 'none') throw new Error(t('ocrUnsupported'))
  if (runtime === 'compat') {
    // WebKit before iOS / iPadOS 16.4: no WASM SIMD. Same models on the plain `ort-wasm.wasm`.
    const ort: Ort = await import('onnxruntime-web-nosimd/wasm')
    ort.env.wasm.numThreads = 1
    ort.env.wasm.simd = false
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmPaths = assetUrl('ort-compat/')
    return { ort, decoderUrl: DEC_COMPAT, sequential: true }
  }
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.wasmPaths = assetUrl('ort/')
  return { ort, decoderUrl: DEC, sequential: false }
}

async function loadSessions() {
  const { ort, decoderUrl, sequential } = await loadRuntime()
  const [vocabRes, encRes, decRes] = await Promise.all([fetch(VOCAB_URL), fetch(ENC), fetch(decoderUrl)])
  if (!vocabRes.ok || !encRes.ok || !decRes.ok) throw new Error(t('modelFiles'))
  const vocab = vocabFromJson(await vocabRes.json())
  const opts = { executionProviders: ['wasm' as const] }
  const [encBytes, decBytes] = [await encRes.arrayBuffer(), await decRes.arrayBuffer()]
  // compat: one at a time, so the 1.18 runtime initialises its WASM once and peak memory stays low
  const [encoder, decoder] = sequential
    ? [await ort.InferenceSession.create(encBytes, opts), await ort.InferenceSession.create(decBytes, opts)]
    : await Promise.all([ort.InferenceSession.create(encBytes, opts), ort.InferenceSession.create(decBytes, opts)])
  return { encoder: wrap(ort, encoder as never), decoder: wrap(ort, decoder as never), vocab }
}

function wrap(ort: Ort, session: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: ArrayBufferView; dims: readonly number[]; dispose?: () => void }>> }): ComerSession {
  return {
    async run(feeds) {
      // tensors must come from the same runtime as the session
      const mapped: Record<string, unknown> = {}
      for (const [name, tensor] of Object.entries(feeds)) {
        mapped[name] = new ort.Tensor(tensor.type, tensor.data as never, tensor.dims)
      }
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

function copyData(data: ArrayBufferView): Float32Array | Uint8Array | BigInt64Array {
  if (data instanceof Float32Array) return Float32Array.from(data)
  if (data instanceof BigInt64Array) return BigInt64Array.from(data)
  if (data instanceof Uint8Array) return Uint8Array.from(data)
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

function toInk(strokes: Stroke[]): InkStroke[] {
  const out: InkStroke[] = []
  for (const stroke of strokes) {
    if (stroke.style === 'marker' || stroke.pts.length < 6) continue
    const points = []
    for (let i = 0; i + 1 < stroke.pts.length; i += 3) points.push({ x: stroke.pts[i], y: stroke.pts[i + 1] })
    if (points.length >= 2) out.push({ points, lineWidth: Math.max(2, stroke.width || 3) })
  }
  return out
}
