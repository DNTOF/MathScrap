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
  if (text.length > MAX_BYTES) throw new Error('这一页太大，没法导出')
  return text
}

/**
 * Accept only a MathScrap sheet envelope, or the same `{strokes,cards,stickers}`
 * object the page already stores. Fields are copied one by one. Strings stay
 * data; nothing in the file is evaluated.
 */
export function parseSheet(raw: string): Doc {
  if (raw.length > MAX_BYTES) throw new Error('文件太大')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('这不是 JSON 文件')
  }
  const root = record(parsed)
  if (!root) throw new Error('文件内容不是一张纸')
  if ('format' in root || 'version' in root || 'doc' in root) {
    if (root.format !== SHEET_FORMAT) throw new Error('这不是 MathScrap 的纸')
    if (root.version !== SHEET_VERSION) throw new Error('这张纸的版本读不了')
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
  if (!src || !Array.isArray(src.strokes) || !Array.isArray(src.cards)) throw new Error('文件里没有笔迹和式子')
  if (src.strokes.length > MAX_STROKES || src.cards.length > MAX_CARDS) throw new Error('这一页的内容太多')
  const stickers = src.stickers == null ? [] : src.stickers
  if (!Array.isArray(stickers) || stickers.length > MAX_STICKERS) throw new Error('这一页的内容太多')
  let numbers = 0
  const strokes = src.strokes.map((item) => {
    const stroke = copyStroke(asStroke(item))
    numbers += stroke.pts.length
    if (numbers > MAX_NUMBERS) throw new Error('笔迹太长')
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
  if (!src) throw new Error('有一笔读不出来')
  const pts = src.pts
  if (!Array.isArray(pts) || pts.length % 3 !== 0) throw new Error('有一笔的点不对')
  const style = src.style
  if (typeof style !== 'string' || !STYLES.has(style as PenStyle | 'marker')) throw new Error('有一笔的笔触不对')
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
  if (!STYLES.has(next.style)) throw new Error('有一笔的笔触不对')
  if (next.pts.length % 3 !== 0) throw new Error('有一笔的点不对')
  if (stroke.recognized !== undefined) next.recognized = bool(stroke.recognized)
  return next
}

function asCard(value: unknown): Card {
  const src = record(value)
  if (!src) throw new Error('有一个式子读不出来')
  return copyCard({ id: idOf(src.id), x: num(src.x), y: num(src.y), text: textOf(src.text, MAX_TEXT) })
}

function copyCard(card: Card): Card {
  return { id: idOf(card.id), x: num(card.x), y: num(card.y), text: textOf(card.text, MAX_TEXT) }
}

function asSticker(value: unknown): Sticker {
  const src = record(value)
  if (!src) throw new Error('有一张字条读不出来')
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
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('有一条内容的编号不对')
  return value
}

function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('有一个数字读不出来')
  return value
}

function widthOf(value: unknown): number {
  const n = num(value)
  if (n <= 0 || n > 256) throw new Error('有一笔太粗或太细')
  return n
}

function colorOf(value: unknown): string {
  if (typeof value !== 'string' || !COLOR.test(value)) throw new Error('有一笔的颜色不对')
  return value
}

function textOf(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new Error('有一段文字读不出来')
  if (value.length > max) throw new Error('有一段文字太长')
  return value
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('有一个开关读不出来')
  return value
}
