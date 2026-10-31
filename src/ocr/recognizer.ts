import type { Stroke } from '@/board/types'
import { strokeBounds } from '@/board/strokes'

export interface Candidate {
  text: string
  confidence: number
}

/**
 * Handwriting → formula contract. A real implementation (on-device model, MyScript,
 * Mathpix, or an LLM vision call) only has to implement `recognize`.
 */
export interface Recognizer {
  id: string
  name: string
  recognize(strokes: Stroke[]): Promise<Candidate[]>
}

/** A reading at or above this is written onto the sheet. Weaker ink is left alone. */
export const OCR_ACCEPT = 0.62

/** Gap (world units) below which nearby strokes are treated as one formula. */
const GAP = 90

/**
 * Group a pool of fresh strokes into clusters that each look like one formula: bounding
 * boxes closer than GAP merge (greedy, left-to-right). This is what lets the automatic
 * pipeline read one formula at a time instead of one stroke at a time.
 */
export function clusterStrokes(strokes: Stroke[]): Stroke[][] {
  const boxes = strokes.map((s) => {
    const b = strokeBounds([s])
    return { s, b }
  })
  const out: { s: Stroke; b: ReturnType<typeof strokeBounds> }[][] = []
  for (const item of boxes) {
    let best: (typeof out)[number] | null = null
    let bestD = Infinity
    for (const cl of out) {
      for (const m of cl) {
        const d = Math.max(item.b.x0 - m.b.x1, m.b.x0 - item.b.x1, (item.b.y0 - m.b.y1) / 2, (m.b.y0 - item.b.y1) / 2)
        if (d < bestD) {
          bestD = d
          best = cl
        }
      }
    }
    if (best && bestD < GAP) best.push(item)
    else out.push([item])
  }
  return out
    .map((cl) => cl.map((m) => m.s))
    .sort((a, b) => {
      const ba = strokeBounds(a)
      const bb = strokeBounds(b)
      return ba.x0 - bb.x0 || ba.y0 - bb.y0
    })
}

/**
 * Sheet reader. The CoMER ONNX model is primary. A miss returns no formula
 * rather than a stand-in equation.
 */
export const mockRecognizer: Recognizer = {
  id: 'comer',
  name: 'CoMER 手写模型（本地 ONNX）',
  async recognize(strokes) {
    try {
      const { recognizeMath } = await import('./comer/web')
      return await recognizeMath(strokes)
    } catch (err) {
      console.error(err instanceof Error ? err.message : '手写模型没有跑起来')
      return []
    }
  },
}
