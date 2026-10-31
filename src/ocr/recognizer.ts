import type { Stroke } from '@/board/types'
import { strokeBounds } from '@/board/strokes'
import { recognizeInk } from './inkShape'

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

/** Gap (world units) below which nearby strokes are treated as one formula. */
const GAP = 90

/**
 * Group a pool of fresh strokes into clusters that each look like one formula: bounding
 * boxes closer than GAP merge (greedy, left-to-right). This is what lets the automatic
 * pipeline raise one candidate chip per written formula instead of per stroke.
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
 * Geometry reader for the on-paper chip. Not a trained model: it knows equals signs,
 * a few letter shapes, digits, and an arrow sitting on a letter. Component tuples are
 * refused unless parenthesis strokes are actually there.
 */
export const mockRecognizer: Recognizer = {
  id: 'stroke-geometry',
  name: '笔画外形（演示，未接识别模型）',
  async recognize(strokes) {
    const cands = recognizeInk(strokes)
    await new Promise((r) => setTimeout(r, 280))
    return cands
  },
}
