import type { Stroke } from '../../board/types.ts'
import { recognizeStrokes, type OcrCandidate } from './engine.ts'
import type { ComerSession, ComerTensor } from './decode.ts'
import { vocabFromJson, type Vocab } from './source.ts'
import type { InkStroke } from './preprocess.ts'

const ENC = '/models/comer/encoder_int8.onnx'
const DEC = '/models/comer/decoder_int8.onnx'
const VOCAB_URL = '/models/comer/vocab.json'

let pending: Promise<{ encoder: ComerSession; decoder: ComerSession; vocab: Vocab }> | null = null
let chain: Promise<unknown> = Promise.resolve()

/** Browser session. The model files are fetched from this origin; weights stay on device. */
export function recognizeMath(strokes: Stroke[]): Promise<OcrCandidate[]> {
  const job = chain.then(() => load().then((ready) => recognizeStrokes(toInk(strokes), ready.encoder, ready.decoder, ready.vocab, 2)))
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

async function loadSessions() {
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.wasmPaths = '/ort/'
  const [vocabRes, encRes, decRes] = await Promise.all([fetch(VOCAB_URL), fetch(ENC), fetch(DEC)])
  if (!vocabRes.ok || !encRes.ok || !decRes.ok) throw new Error('手写模型文件缺失')
  const vocab = vocabFromJson(await vocabRes.json())
  const opts = { executionProviders: ['wasm' as const] }
  const [encoder, decoder] = await Promise.all([
    ort.InferenceSession.create(await encRes.arrayBuffer(), opts),
    ort.InferenceSession.create(await decRes.arrayBuffer(), opts),
  ])
  return { encoder: wrap(encoder as never), decoder: wrap(decoder as never), vocab }
}

function wrap(session: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: ArrayBufferView; dims: readonly number[]; dispose?: () => void }>> }): ComerSession {
  return {
    async run(feeds) {
      const ort = await import('onnxruntime-web/wasm')
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
