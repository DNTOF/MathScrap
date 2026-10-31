/**
 * Greedy / beam decode for the CoMER encoder+decoder pair.
 * Sessions are injected so the same loop runs on onnxruntime-web today
 * and on native ONNX Runtime later. This file does not import a runtime.
 */

export interface ComerTensor {
  type: 'float32' | 'bool' | 'int64'
  data: Float32Array | Uint8Array | BigInt64Array
  dims: number[]
  dispose?: () => void
}

export interface ComerSession {
  run(feeds: Record<string, ComerTensor>): Promise<Record<string, ComerTensor>>
}

export interface DecodeOptions {
  sos: number
  eos: number
  vocabSize: number
  beamWidth?: number
  maxSteps?: number
}

export interface DecodeHit {
  ids: number[]
  logProb: number
}

const REPEAT_LIMIT = 3

export async function decodeComer(encoder: ComerSession, decoder: ComerSession, pixel: ComerTensor, mask: ComerTensor, opts: DecodeOptions): Promise<DecodeHit[]> {
  const encoded = await encoder.run({ pixel_values: pixel, pixel_mask: mask })
  const features = encoded.encoder_features
  const encMask = encoded.encoder_mask
  if (!features || !encMask) throw new Error('编码器没有返回特征')
  try {
    const beam = Math.max(1, opts.beamWidth ?? 1)
    return beam <= 1 ? [await greedy(decoder, features, encMask, opts)] : await beamSearch(decoder, features, encMask, opts, beam)
  } finally {
    features.dispose?.()
    encMask.dispose?.()
  }
}

async function greedy(decoder: ComerSession, features: ComerTensor, encMask: ComerTensor, opts: DecodeOptions): Promise<DecodeHit> {
  const ids = [opts.sos]
  let logProb = 0
  let repeat = 0
  let last = -1
  const steps = opts.maxSteps ?? 40
  for (let step = 0; step < steps; step++) {
    const { next, lp } = await nextToken(decoder, features, encMask, ids, opts.vocabSize)
    if (next === opts.eos) break
    logProb += lp
    if (next === last) {
      repeat++
      if (repeat >= REPEAT_LIMIT) break
    } else repeat = 0
    last = next
    ids.push(next)
  }
  return { ids: ids.slice(1), logProb }
}

async function beamSearch(decoder: ComerSession, features: ComerTensor, encMask: ComerTensor, opts: DecodeOptions, width: number): Promise<DecodeHit[]> {
  let beams: { ids: number[]; logProb: number; finished: boolean }[] = [{ ids: [opts.sos], logProb: 0, finished: false }]
  const steps = opts.maxSteps ?? 40
  for (let step = 0; step < steps; step++) {
    const pool: typeof beams = []
    for (const beam of beams) {
      if (beam.finished) {
        pool.push(beam)
        continue
      }
      const logits = await logitsOf(decoder, features, encMask, beam.ids)
      const offset = (beam.ids.length - 1) * opts.vocabSize
      const logProbs = logSoftmax(logits, offset, opts.vocabSize)
      for (const idx of topK(logProbs, width * 2)) {
        const logProb = beam.logProb + (logProbs[idx] ?? -1e9)
        if (idx === opts.eos || tailRepeat(beam.ids, idx) >= REPEAT_LIMIT) pool.push({ ids: beam.ids, logProb, finished: true })
        else pool.push({ ids: [...beam.ids, idx], logProb, finished: false })
      }
    }
    pool.sort((a, b) => b.logProb / Math.max(1, b.ids.length) - a.logProb / Math.max(1, a.ids.length))
    beams = pool.slice(0, width)
    if (beams.every((b) => b.finished)) break
  }
  const done = beams.filter((b) => b.finished)
  const ranked = (done.length ? done : beams).sort((a, b) => b.logProb / Math.max(1, a.ids.length) - a.logProb / Math.max(1, a.ids.length))
  return ranked.slice(0, width).map((b) => ({ ids: b.ids.slice(1), logProb: b.logProb }))
}

async function nextToken(decoder: ComerSession, features: ComerTensor, encMask: ComerTensor, ids: number[], vocabSize: number) {
  const logits = await logitsOf(decoder, features, encMask, ids)
  const offset = (ids.length - 1) * vocabSize
  const logProbs = logSoftmax(logits, offset, vocabSize)
  let best = 0
  let val = -Infinity
  for (let i = 0; i < vocabSize; i++) {
    if ((logProbs[i] ?? -Infinity) > val) {
      val = logProbs[i] ?? -Infinity
      best = i
    }
  }
  return { next: best, lp: val }
}

async function logitsOf(decoder: ComerSession, features: ComerTensor, encMask: ComerTensor, ids: number[]): Promise<Float32Array> {
  const input: ComerTensor = { type: 'int64', data: BigInt64Array.from(ids.map((id) => BigInt(id))), dims: [1, ids.length] }
  const out = await decoder.run({ encoder_features: features, encoder_mask: encMask, input_ids: input })
  const logits = out.logits
  if (!logits || !(logits.data instanceof Float32Array)) throw new Error('解码器没有返回 logits')
  const copy = Float32Array.from(logits.data)
  logits.dispose?.()
  return copy
}

function tailRepeat(ids: number[], idx: number) {
  let n = 0
  for (let j = ids.length - 1; j >= 1; j--) {
    if (ids[j] === idx) n++
    else break
  }
  return n
}

function logSoftmax(logits: Float32Array, offset: number, size: number) {
  const result = new Float64Array(size)
  let max = -Infinity
  for (let i = 0; i < size; i++) max = Math.max(max, logits[offset + i] ?? -Infinity)
  let sum = 0
  for (let i = 0; i < size; i++) sum += Math.exp((logits[offset + i] ?? -Infinity) - max)
  const logZ = Math.log(sum)
  for (let i = 0; i < size; i++) result[i] = (logits[offset + i] ?? -Infinity) - max - logZ
  return result
}

function topK(arr: Float64Array, k: number) {
  return Array.from(arr.keys()).sort((a, b) => (arr[b] ?? 0) - (arr[a] ?? 0)).slice(0, k)
}
