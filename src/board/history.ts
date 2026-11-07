import type { Doc } from './types'

const LIMIT = 120

/** One undo step: the document and which formula was selected when it was recorded. */
export interface HistEntry {
  doc: Doc
  selected: string | null
}

export function sameDoc(a: Doc, b: Doc) {
  if (a === b) return true
  if (a.strokes.length !== b.strokes.length || a.cards.length !== b.cards.length || a.stickers.length !== b.stickers.length) return false
  for (let i = 0; i < a.strokes.length; i++) if (a.strokes[i] !== b.strokes[i]) return false
  for (let i = 0; i < a.cards.length; i++) {
    const p = a.cards[i]
    const q = b.cards[i]
    if (p !== q && (p.id !== q.id || p.x !== q.x || p.y !== q.y || p.text !== q.text)) return false
  }
  for (let i = 0; i < a.stickers.length; i++) {
    const p = a.stickers[i]
    const q = b.stickers[i]
    if (p !== q && (p.id !== q.id || p.x !== q.x || p.y !== q.y || p.text !== q.text || p.size !== q.size || p.rot !== q.rot)) return false
  }
  return true
}

/** Push `prev` only when `next` actually differs. An unchanged edit does not grow the stack. */
export function pushCommit(past: readonly HistEntry[], prev: Doc, next: Doc, selected: string | null): { past: HistEntry[]; changed: boolean } {
  if (sameDoc(prev, next)) return { past: past as HistEntry[], changed: false }
  const copy = past.concat([{ doc: prev, selected }])
  if (copy.length > LIMIT) copy.splice(0, copy.length - LIMIT)
  return { past: copy, changed: true }
}

export function applyUndo(past: readonly HistEntry[], future: readonly HistEntry[], doc: Doc, selected: string | null) {
  if (past.length === 0) return { past: past as HistEntry[], future: future as HistEntry[], doc, selected, changed: false as const }
  const prev = past[past.length - 1]
  return {
    past: past.slice(0, -1),
    future: future.concat([{ doc, selected }]),
    doc: prev.doc,
    selected: prev.selected,
    changed: true as const,
  }
}

export function applyRedo(past: readonly HistEntry[], future: readonly HistEntry[], doc: Doc, selected: string | null) {
  if (future.length === 0) return { past: past as HistEntry[], future: future as HistEntry[], doc, selected, changed: false as const }
  const next = future[future.length - 1]
  return {
    past: past.concat([{ doc, selected }]),
    future: future.slice(0, -1),
    doc: next.doc,
    selected: next.selected,
    changed: true as const,
  }
}
