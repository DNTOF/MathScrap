import { decodeComer, type ComerSession, type ComerTensor } from './decode.ts'
import { isInkMeaningful, preprocessStrokes, type InkStroke } from './preprocess.ts'
import { decodeTokens, tokensToSource, type Vocab } from './source.ts'

export interface OcrCandidate {
  text: string
  confidence: number
  latex: string
}

/**
 * Stroke points → LaTeX candidates.
 * `encoder` / `decoder` are the CoMER INT8 sessions. The web demo builds them
 * with onnxruntime-web; a native app builds them with ONNX Runtime and calls
 * this same function.
 */
export async function recognizeStrokes(strokes: InkStroke[], encoder: ComerSession, decoder: ComerSession, vocab: Vocab, beamWidth = 2): Promise<OcrCandidate[]> {
  if (!isInkMeaningful(strokes)) return []
  const image = preprocessStrokes(strokes)
  const pixel: ComerTensor = { type: 'float32', data: image.tensor, dims: [1, 1, image.height, image.width] }
  const mask: ComerTensor = { type: 'bool', data: image.mask, dims: [1, image.maskHeight, image.maskWidth] }
  const hits = await decodeComer(encoder, decoder, pixel, mask, {
    sos: vocab.special_tokens.sos,
    eos: vocab.special_tokens.eos,
    vocabSize: vocab.vocab_size,
    beamWidth,
    maxSteps: 40,
  })
  const out: OcrCandidate[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const latex = decodeTokens(hit.ids, vocab).join(' ')
    const text = tokensToSource(decodeTokens(hit.ids, vocab))
    if (!text || seen.has(text)) continue
    seen.add(text)
    const n = Math.max(1, hit.ids.length)
    const mean = hit.logProb / n
    const confidence = Math.exp(mean)
    if (!Number.isFinite(confidence) || confidence < 0.2) continue
    out.push({ text, confidence: Math.min(0.97, confidence), latex })
  }
  const best = out[0]?.confidence ?? 0
  return out.filter((c, i) => i === 0 || c.confidence >= best - 0.22).slice(0, 3)
}
