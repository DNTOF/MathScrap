import { bindInk, findOverArrow } from './bind.ts'
import { decodeComer, type ComerSession, type ComerTensor } from './decode.ts'
import { isInkMeaningful, preprocessStrokes, type InkStroke } from './preprocess.ts'
import { repairIsolatedSigma } from './sigma.ts'
import { decodeTokens, tokensToSource, type Vocab } from './source.ts'

export interface OcrCandidate {
  text: string
  confidence: number
  latex: string
}

/**
 * The live over-arrow sample scores about 0.48, under the sheet's 0.62 write
 * line. A read at or above this, when the ink agrees, is lifted. Weaker than
 * this stays ink.
 */
const AGREE_AT = 0.42
/** Above the sheet accept threshold (0.62), below the 0.97 cap. */
const AGREED = 0.78

/**
 * Raise confidence only when the decoder and the ink describe the same thing:
 * an over-arrow letter, a summation / integral, or a bare Greek name the sheet
 * already parses. Ordinary formulas (`y = 2`) and faint reads are unchanged.
 */
export function agreeConfidence(strokes: InkStroke[], text: string, model: number): number {
  if (!Number.isFinite(model) || model < 0) return 0
  const capped = Math.min(0.97, model)
  if (model < AGREE_AT) return capped
  const t = text.trim()
  const arrow = /^\\vec\{[a-z]\} = \(/.test(t) && findOverArrow(strokes) != null
  const sum = /^(?:y\s*=\s*)?\\(?:sum|int)(?![A-Za-z])/.test(t)
  const greek = /^(?:sigma|pi|theta|alpha|beta|gamma|lambda|mu|phi)$/.test(t)
  if (arrow || sum || greek) return Math.max(capped, AGREED)
  return capped
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
    const decoded = decodeTokens(hit.ids, vocab)
    const latex = decoded.join(' ')
    const source = tokensToSource(decoded)
    const n = Math.max(1, hit.ids.length)
    const mean = hit.logProb / n
    const model = Math.exp(mean)
    if (!Number.isFinite(model) || model < 0.2) continue
    // A mid-or-better read of 0 / Y / u is σ only when the ink has that glyph.
    // Fainter than AGREE_AT stays the model's text, so a weak guess is not promoted.
    const repaired = model >= AGREE_AT ? repairIsolatedSigma(strokes, source) : null
    const text = repaired ?? bindInk(strokes, source)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push({ text, confidence: agreeConfidence(strokes, text, model), latex })
  }
  out.sort((a, b) => b.confidence - a.confidence || a.text.localeCompare(b.text))
  const best = out[0]?.confidence ?? 0
  return out.filter((c, i) => i === 0 || c.confidence >= best - 0.22).slice(0, 3)
}
