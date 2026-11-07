import { useCallback, useEffect, useRef, useState } from 'react'
import type { Doc } from './types'

const KEY = 'mathscrap.doc.v2'
const LIMIT = 120

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
  const past = useRef<Doc[]>([])
  const future = useRef<Doc[]>([])
  const [nav, setNav] = useState({ undo: false, redo: false })
  const docRef = useRef(doc)
  const remember = () => setNav({ undo: past.current.length > 0, redo: future.current.length > 0 })

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
    past.current.push(prev)
    if (past.current.length > LIMIT) past.current.shift()
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
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(docRef.current)
    docRef.current = prev
    setDoc(prev)
    remember()
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(docRef.current)
    docRef.current = next
    setDoc(next)
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
  }
}
