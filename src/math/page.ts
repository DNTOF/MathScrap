import type { Card } from '@/board/types'
import { summarizeCard, type CardSummary } from './scene'

export interface PageEntry {
  card: Card
  summary: CardSummary
  /** Which shared coordinate system this formula belongs to. */
  dim: 2 | 3
  /** Conditions only (e.g. `AC ⊥ BC`, `f(0) = 1`): nothing to draw by itself. */
  condition: boolean
}

export interface PageGroups {
  entries: PageEntry[]
  count: Record<2 | 3, number>
}

/**
 * The whole sheet is one problem: every formula joins one of two shared coordinate systems
 * (plane or space). A formula that only adds conditions follows the formula written before it.
 */
export function pageGroups(cards: Card[]): PageGroups {
  const entries: PageEntry[] = []
  const count = { 2: 0, 3: 0 }
  let last: 2 | 3 = 2
  for (const card of cards) {
    if (!card.text.trim()) continue
    const summary = summarizeCard(card.text)
    const condition = !summary.kinds.some((k) => k !== 'constraint')
    const dim: 2 | 3 = condition ? last : summary.dim
    if (!condition) last = dim
    if (!condition && summary.kinds.length) count[dim]++
    entries.push({ card, summary, dim, condition })
  }
  return { entries, count }
}
