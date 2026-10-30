/** `select` moves formulas and pans empty paper; `type` places a formula wherever you tap. */
export type Tool = 'pen' | 'marker' | 'eraser' | 'select' | 'type'

export type PenStyle = 'ink' | 'dashed' | 'dotted' | 'pencil' | 'washi'

export interface Stroke {
  id: string
  /** flat [x, y, pressure, x, y, pressure, ...] in world coordinates */
  pts: number[]
  color: string
  width: number
  style: PenStyle | 'marker'
  /** set once the stroke has been turned into a typed formula via handwriting recognition */
  recognized?: boolean
  createdAt: number
}

/** A formula written directly on the sheet (one or more lines, top-left anchored at x/y). */
export interface Card {
  id: string
  x: number
  y: number
  text: string
}

export interface Sticker {
  id: string
  x: number
  y: number
  text: string
  size: number
  rot: number
}

export interface Doc {
  strokes: Stroke[]
  cards: Card[]
  stickers: Sticker[]
}

export interface View {
  x: number
  y: number
  scale: number
}

export const INK_COLORS = [
  { name: '墨黑', value: '#2b2118' },
  { name: '赭红', value: '#9b3b2a' },
  { name: '靛蓝', value: '#2f4a6d' },
  { name: '苔绿', value: '#4d6b3c' },
  { name: '姜黄', value: '#b9852a' },
  { name: '粉笔白', value: '#f6eedd' },
]
export const uid = () => Math.random().toString(36).slice(2, 10)
