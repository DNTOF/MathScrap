import { t } from '@/i18n/locale'
import type { Card, Doc, PenStyle, Sticker, Stroke } from './types'

export const SHEET_FORMAT = 'mathscrap.sheet'
export const SHEET_VERSION = 1

const MAX_BYTES = 8_000_000
const MAX_STROKES = 4_000
const MAX_CARDS = 2_000
const MAX_STICKERS = 500
const MAX_NUMBERS = 2_000_000
const MAX_TEXT = 8_000
const MAX_STICKER_TEXT = 400
const ID = /^[A-Za-z0-9_-]{1,40}$/
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const STYLES = new Set<PenStyle | 'marker'>(['ink', 'dashed', 'dotted', 'pencil', 'washi', 'marker'])

export function serializeSheet(doc: Doc): string {
  const body = {
    format: SHEET_FORMAT,
    version: SHEET_VERSION,
    doc: copyDoc(doc),
  }
  const text = JSON.stringify(body)
  if (text.length > MAX_BYTES) throw new Error(t('sheetTooBig'))
  return text
}

/**
 * Accept only a MathScrap sheet envelope, or the same `{strokes,cards,stickers}`
 * object the page already stores. Fields are copied one by one. Strings stay
 * data; nothing in the file is evaluated.
 */
export function parseSheet(raw: string): Doc {
  if (raw.length > MAX_BYTES) throw new Error(t('fileTooBig'))
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(t('notJsonFile'))
  }
  const root = record(parsed)
  if (!root) throw new Error(t('notASheet'))
  if ('format' in root || 'version' in root || 'doc' in root) {
    if (root.format !== SHEET_FORMAT) throw new Error(t('notMathScrap'))
    if (root.version !== SHEET_VERSION) throw new Error(t('sheetVersion'))
    return copyDoc(asDoc(root.doc))
  }
  return copyDoc(asDoc(root))
}

function copyDoc(doc: Doc): Doc {
  return {
    strokes: doc.strokes.map(copyStroke),
    cards: doc.cards.map(copyCard),
    stickers: doc.stickers.map(copySticker),
  }
}

function asDoc(value: unknown): Doc {
  const src = record(value)
  if (!src || !Array.isArray(src.strokes) || !Array.isArray(src.cards)) throw new Error(t('noInk'))
  if (src.strokes.length > MAX_STROKES || src.cards.length > MAX_CARDS) throw new Error(t('tooMuch'))
  const stickers = src.stickers == null ? [] : src.stickers
  if (!Array.isArray(stickers) || stickers.length > MAX_STICKERS) throw new Error(t('tooMuch'))
  let numbers = 0
  const strokes = src.strokes.map((item) => {
    const stroke = copyStroke(asStroke(item))
    numbers += stroke.pts.length
    if (numbers > MAX_NUMBERS) throw new Error(t('strokeTooLong'))
    return stroke
  })
  return {
    strokes,
    cards: src.cards.map((item) => copyCard(asCard(item))),
    stickers: stickers.map((item) => copySticker(asSticker(item))),
  }
}

function asStroke(value: unknown): Stroke {
  const src = record(value)
  if (!src) throw new Error(t('badStroke'))
  const pts = src.pts
  if (!Array.isArray(pts) || pts.length % 3 !== 0) throw new Error(t('badPoints'))
  const style = src.style
  if (typeof style !== 'string' || !STYLES.has(style as PenStyle | 'marker')) throw new Error(t('badStyle'))
  return {
    id: idOf(src.id),
    pts: pts.map(num),
    color: colorOf(src.color),
    width: widthOf(src.width),
    style: style as PenStyle | 'marker',
    recognized: src.recognized === undefined ? undefined : bool(src.recognized),
    createdAt: num(src.createdAt),
  }
}

function copyStroke(stroke: Stroke): Stroke {
  const next: Stroke = {
    id: idOf(stroke.id),
    pts: stroke.pts.map(num),
    color: colorOf(stroke.color),
    width: widthOf(stroke.width),
    style: stroke.style,
    createdAt: num(stroke.createdAt),
  }
  if (!STYLES.has(next.style)) throw new Error(t('badStyle'))
  if (next.pts.length % 3 !== 0) throw new Error(t('badPoints'))
  if (stroke.recognized !== undefined) next.recognized = bool(stroke.recognized)
  return next
}

function asCard(value: unknown): Card {
  const src = record(value)
  if (!src) throw new Error(t('badCard'))
  return copyCard({ id: idOf(src.id), x: num(src.x), y: num(src.y), text: textOf(src.text, MAX_TEXT) })
}

function copyCard(card: Card): Card {
  return { id: idOf(card.id), x: num(card.x), y: num(card.y), text: textOf(card.text, MAX_TEXT) }
}

function asSticker(value: unknown): Sticker {
  const src = record(value)
  if (!src) throw new Error(t('badSticker'))
  return copySticker({
    id: idOf(src.id),
    x: num(src.x),
    y: num(src.y),
    text: textOf(src.text, MAX_STICKER_TEXT),
    size: widthOf(src.size),
    rot: num(src.rot),
  })
}

function copySticker(sticker: Sticker): Sticker {
  return {
    id: idOf(sticker.id),
    x: num(sticker.x),
    y: num(sticker.y),
    text: textOf(sticker.text, MAX_STICKER_TEXT),
    size: widthOf(sticker.size),
    rot: num(sticker.rot),
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function idOf(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(t('badId'))
  return value
}

function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(t('badNumber'))
  return value
}

function widthOf(value: unknown): number {
  const n = num(value)
  if (n <= 0 || n > 256) throw new Error(t('badWidth'))
  return n
}

function colorOf(value: unknown): string {
  if (typeof value !== 'string' || !COLOR.test(value)) throw new Error(t('badColor'))
  return value
}

function textOf(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new Error(t('badText'))
  if (value.length > max) throw new Error(t('textTooLong'))
  return value
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(t('badBool'))
  return value
}
