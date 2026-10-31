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

/** Demo stub: guesses from stroke shape statistics; the user always confirms or edits. */
export const mockRecognizer: Recognizer = {
  id: 'mock',
  name: '演示桩（未接入识别模型）',
  async recognize(strokes) {
    const b = strokeBounds(strokes)
    const aspect = (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0)
    const n = strokes.length
    const pool = [
      { text: 'y = x^2 - 2', when: aspect > 2.2 && n >= 4 },
      { text: 'y = 2x + 1', when: aspect > 2.2 && n < 6 },
      { text: 'x^2 + y^2 = 4', when: aspect > 3 },
      { text: '△ABC: a = 3, b = 4, C = 90°', when: n >= 8 },
      { text: 'z = sin(x)cos(y)', when: aspect > 2.5 && n >= 6 },
      { text: '𝐚 = (1, 2, 2)', when: aspect > 1.5 },
      { text: 'y = sqrt(x)', when: aspect <= 2.2 },
    ]
    const picked = pool.filter((p) => p.when).map((p) => p.text)
    for (const p of pool) if (!picked.includes(p.text)) picked.push(p.text)
    await new Promise((r) => setTimeout(r, 380))
    return picked.slice(0, 4).map((text, i) => ({ text, confidence: Math.max(0.2, 0.62 - i * 0.14) }))
  },
}
