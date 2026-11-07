import { useCallback, useEffect, useRef, useState } from 'react'
import { applyRedo, applyUndo, pushCommit, type HistEntry } from './history'
import type { Doc } from './types'

const KEY = 'mathscrap.doc.v2'

export const blankDoc = (): Doc => ({ strokes: [], cards: [], stickers: [] })

function load(): Doc {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const d = JSON.parse(raw) as Doc
      if (Array.isArray(d.cards) && Array.isArray(d.strokes)) return { ...d, stickers: d.stickers ?? [] }
    }
  } catch {
    /* corrupted storage: start from a blank sheet */
  }
  return blankDoc()
}

/**
 * Document state with undo/redo. `commit` records history; `preview` updates without
 * recording (used while dragging) and the following `commit(…, base)` records from `base`.
 */
export function useDocument() {
  const [doc, setDoc] = useState<Doc>(load)
  const past = useRef<HistEntry[]>([])
  const future = useRef<HistEntry[]>([])
  const [nav, setNav] = useState({ undo: false, redo: false })
  const docRef = useRef(doc)
  const [selected, setSelectedState] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const remember = () => setNav({ undo: past.current.length > 0, redo: future.current.length > 0 })
  const setSelected = useCallback((id: string | null) => {
    selectedRef.current = id
    setSelectedState(id)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(doc))
      } catch {
        /* storage full or disabled — the page still works in memory */
      }
    }, 300)
    return () => clearTimeout(t)
  }, [doc])

  const commit = useCallback((next: Doc | ((d: Doc) => Doc), base?: Doc) => {
    const prev = base ?? docRef.current
    const value = typeof next === 'function' ? next(docRef.current) : next
    const recorded = pushCommit(past.current, prev, value, selectedRef.current)
    if (!recorded.changed) return
    past.current = recorded.past
    future.current = []
    docRef.current = value
    setDoc(value)
    remember()
  }, [])

  const preview = useCallback((next: (d: Doc) => Doc) => {
    const value = next(docRef.current)
    docRef.current = value
    setDoc(value)
  }, [])

  const undo = useCallback(() => {
    const step = applyUndo(past.current, future.current, docRef.current, selectedRef.current)
    if (!step.changed) return
    past.current = step.past
    future.current = step.future
    docRef.current = step.doc
    selectedRef.current = step.selected
    setDoc(step.doc)
    setSelectedState(step.selected)
    remember()
  }, [])

  const redo = useCallback(() => {
    const step = applyRedo(past.current, future.current, docRef.current, selectedRef.current)
    if (!step.changed) return
    past.current = step.past
    future.current = step.future
    docRef.current = step.doc
    selectedRef.current = step.selected
    setDoc(step.doc)
    setSelectedState(step.selected)
    remember()
  }, [])

  return {
    doc,
    docRef,
    commit,
    preview,
    undo,
    redo,
    canUndo: nav.undo,
    canRedo: nav.redo,
    selected,
    setSelected,
  }
}
