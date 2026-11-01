import { engine } from '@/wasm/engine'

/** A reference to a direction: segment AB (from points) or a named vector. */
export type Ref = { kind: 'seg'; p: string; q: string } | { kind: 'vec'; name: string }

export type Constraint =
  | { type: 'perp' | 'para'; a: Ref; b: Ref }
  | { type: 'len'; ref: Ref; value: string }
  | { type: 'angle'; p: string; q: string; r: string; value: string }
  | { type: 'through'; coords: string[] | null; point: string | null }
  | { type: 'fcall'; fname: string; arg: string; value: string; deriv: boolean }
  | { type: 'equation'; F: string }

export type Statement =
  | { kind: 'curve'; name?: string; expr: string; src: string }
  | { kind: 'implicit2'; name?: string; F: string; src: string }
  /** Equation in x alone (e.g. x^2 + 2x + 1 = 0): solved for x, drawn as y = F(x). */
  | { kind: 'equation1'; F: string; lhs: string; rhs: string; src: string }
  | { kind: 'surface'; name?: string; expr: string; src: string }
  | { kind: 'implicit3'; name?: string; F: string; src: string }
  | { kind: 'point'; name: string; coords: string[]; src: string }
  | { kind: 'vector'; name: string; comps: string[]; src: string }
  | { kind: 'param'; name: string; comps: string[]; src: string }
  | { kind: 'triangle'; names: string; known: Record<string, string>; src: string }
  | { kind: 'circle'; name: string; center: string | null; radius: string | null; through: { coords: string[] | null; point: string | null }[]; src: string }
  | { kind: 'chords'; p: string; chords: string[][]; lengths: Record<string, string>; pos: 'in' | 'out' | 'tan' | null; src: string }
  /** M = 中点(A, B) or P = 分点(A, B, 1:2) — a point defined from two existing ones. */
  | { kind: 'pointDef'; name: string; a: string; b: string; m: string | null; n: string | null; src: string }
  /** 𝐩 = 投影(𝐚, 𝐛), 𝐜 = 𝐚 + 𝐛, 𝐜 = 𝐚 − 𝐛 — a vector defined from existing ones. */
  | { kind: 'vectorDef'; name: string; op: 'proj' | 'sum' | 'sub'; a: string; b: string; src: string }
  | { kind: 'constraint'; c: Constraint; src: string }
  /** Display-only CoMER notation (`\sum_{i=1}^{n} i`, `\int`). Not a curve and not an error. */
  | { kind: 'notation'; latex: string; src: string }
  | { kind: 'error'; message: string; src: string }

const BOLD_A = 0x1d41a

/** Math-bold small letter (𝐚…𝐳) — the canonical spelling of a vector name. */
export const bold = (letter: string) => String.fromCodePoint(BOLD_A + letter.charCodeAt(0) - 97)
const BOLD_CLASS = '[\\u{1D41A}-\\u{1D433}]'
const BOLD_NAME = `${BOLD_CLASS}(?:_\\w+)?`
const unbold = (name: string) => name.replace(new RegExp(BOLD_CLASS, 'gu'), (c) => String.fromCharCode(97 + c.codePointAt(0)! - BOLD_A))
const isBoldName = (s: string) => new RegExp(`^${BOLD_NAME}$`, 'u').test(s)

/**
 * Explicit vector spellings all become math-bold letters: 𝐛, **b**, \mathbf{b}, \bm{b},
 * \boldsymbol{b}, \vec{b}, vec b, and bold-italic 𝒃. A plain lowercase letter is never a vector
 * definition (and never a point).
 */
function boldify(text: string): string {
  return text
    .replace(/[\u{1D482}-\u{1D49B}]/gu, (c) => bold(String.fromCharCode(97 + c.codePointAt(0)! - 0x1d482)))
    .replace(/\\(?:mathbf|bm|boldsymbol|vec)\s*\{\s*([a-z])\s*\}/g, (_, c) => bold(c))
    .replace(/\\(?:mathbf|bm|boldsymbol|vec)\s+([a-z])(?![a-z])/g, (_, c) => bold(c))
    .replace(/\*\*([a-z])\*\*/g, (_, c) => bold(c))
    .replace(/\bvec\s+([a-z])(?![a-z])/g, (_, c) => bold(c))
}

export function normalize(text: string): string {
  return boldify(text)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/＝/g, '=')
    .replace(/：/g, ':')
    .replace(/＋/g, '+')
    .replace(/[－−–]/g, '-')
    .replace(/_\|_/g, '⊥')
    .replace(/\bperp\b/gi, '⊥')
    .replace(/\bparallel\b/gi, '∥')
    .replace(/\/\//g, '∥')
    .replace(/\|\|/g, '∥')
    .replace(/[<⟨]([^<>⟨⟩=]*,[^<>⟨⟩=]*)[>⟩]/g, '($1)')
    .replace(/\bangle\s*/gi, '∠')
    .replace(/\bdeg\b/g, '°')
}

export function splitTop(src: string, seps: string[]): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of src) {
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (depth === 0 && seps.includes(ch)) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** "(a, b, c)" → ["a","b","c"]; null when not a 2–3 component tuple. */
export function tupleParts(src: string): string[] | null {
  const t = src.trim()
  if (!t.startsWith('(') || !t.endsWith(')')) return null
  // make sure the outer parens enclose everything
  let depth = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++
    else if (t[i] === ')') depth--
    if (depth === 0 && i < t.length - 1) return null
  }
  const parts = splitTop(t.slice(1, -1), [','])
  return parts.length >= 2 && parts.length <= 3 ? parts : null
}

const TRI_RE = /^(?:△|triangle|tri|三角形)\s*([A-Z]{3})?\s*:?\s*(.*)$/i

/** AB → segment; 𝐚 (or a plain `a` naming an already-defined vector) → vector. */
function parseRef(s: string): Ref | null {
  const t = s.trim().replace(/^\|(.*)\|$/, '$1').trim()
  if (/^[A-Z][A-Z]$/.test(t)) return { kind: 'seg', p: t[0], q: t[1] }
  if (isBoldName(t)) return { kind: 'vec', name: unbold(t) }
  if (/^[a-z](_\w+)?$/.test(t)) return { kind: 'vec', name: t }
  return null
}

function vars(src: string): string[] | null {
  const r = engine.inspect(src)
  return r.ok ? r.vars : null
}

function err(src: string, message: string): Statement {
  return { kind: 'error', message, src }
}

const NOTATION_OPS = ['\\sum', '\\int']

/**
 * `\sum_{i=1}^{n} i` and the same shape with `\int`. The sheet cannot plot these,
 * but they are real formulas: the card shows the LaTeX and does not go red.
 * Spaces inside limits are kept out of the rendered form (`i = 1` → `i=1`).
 */
function notationLatex(src: string): string | null {
  let raw = src.trim().replace(/∑/g, '\\sum').replace(/∫/g, '\\int')
  let prefix = ''
  const lead = raw.match(/^y\s*=\s*/)
  if (lead) {
    const rest = raw.slice(lead[0].length).trim()
    if (NOTATION_OPS.some((op) => rest.startsWith(op))) {
      prefix = 'y = '
      raw = rest
    }
  }
  const op = NOTATION_OPS.find((name) => raw.startsWith(name) && !/[A-Za-z]/.test(raw[name.length] ?? ''))
  if (!op) return null
  let i = op.length
  let sub: string | null = null
  let sup: string | null = null
  const braceAt = (at: number) => {
    if (raw[at] !== '{') return null
    let depth = 0
    for (let j = at; j < raw.length; j++) {
      if (raw[j] === '{') depth++
      else if (raw[j] === '}') {
        depth--
        if (depth === 0) return { inner: raw.slice(at + 1, j).replace(/\s+/g, ''), next: j + 1 }
      }
    }
    return null
  }
  const take = (mark: '_' | '^') => {
    let j = i
    while (raw[j] === ' ') j++
    if (raw.startsWith('\\limits', j)) {
      j += '\\limits'.length
      while (raw[j] === ' ') j++
    }
    if (raw[j] !== mark) return
    const brace = braceAt(j + 1)
    if (!brace) return
    i = brace.next
    if (mark === '_') sub = brace.inner
    else sup = brace.inner
  }
  take('_')
  take('^')
  if (sub == null) take('_')
  while (raw[i] === ' ') i++
  const term = raw.slice(i).trim()
  if (/[=;]/.test(term)) return null
  let latex = op
  if (sub) latex += `_{${sub}}`
  if (sup) latex += `^{${sup}}`
  if (term) latex += ` ${term}`
  return prefix + latex
}

function asNotation(src: string): Statement | null {
  const latex = notationLatex(src)
  if (!latex) return null
  return { kind: 'notation', latex, src: src.trim() }
}

/** A lone σ is the symbol. It is not the graph of y = sigma. */
function asSigma(src: string): Statement | null {
  const t = src.trim()
  if (t !== 'sigma' && t !== 'σ' && t !== '\\sigma') return null
  return { kind: 'notation', latex: '\\sigma', src: t }
}

function classifyPart(part: string): Statement[] {
  const src = part.trim()
  if (!src) return []
  const notation = asNotation(src)
  if (notation) return [notation]
  const sigma = asSigma(src)
  if (sigma) return [sigma]

  // 过(1,3) / through (1,3) and (2,5) / 过点A
  const through = src.match(/^(?:过|经过|through|passes|pass)\s*(?:点)?\s*(.*)$/i)
  if (through) {
    const rest = through[1]
    const pieces = rest.split(/\s*(?:和|与|及|and|&)\s*/).filter(Boolean)
    const out: Statement[] = []
    for (const p of pieces) {
      const tp = tupleParts(p)
      if (tp) out.push({ kind: 'constraint', c: { type: 'through', coords: tp, point: null }, src: `过 ${p}` })
      else if (/^[A-Z]$/.test(p.trim())) out.push({ kind: 'constraint', c: { type: 'through', coords: null, point: p.trim() }, src: `过 ${p}` })
      else out.push(err(p, '“过”后面写点坐标，例如 过(1, 3)'))
    }
    return out
  }

  // ∠ABC = 60°
  const ang = src.match(/^∠\s*([A-Z])([A-Z])([A-Z])\s*=\s*(.+)$/)
  if (ang) return [{ kind: 'constraint', c: { type: 'angle', p: ang[1], q: ang[2], r: ang[3], value: ang[4] }, src }]

  // AB ⊥ CD, a ∥ b
  const rel = src.match(/^(.+?)\s*([⊥∥])\s*(.+)$/)
  if (rel) {
    const a = parseRef(rel[1])
    const b = parseRef(rel[3])
    if (!a || !b) return [err(src, '⊥ / ∥ 两边请写线段（如 AB）或粗体向量（如 **a**）')]
    return [{ kind: 'constraint', c: { type: rel[2] === '⊥' ? 'perp' : 'para', a, b }, src }]
  }

  // r(t) = (cos t, sin t, t)
  const param = src.match(/^([a-zA-Z](?:_\w+)?)\s*\(\s*t\s*\)\s*=\s*(.+)$/)
  if (param) {
    const tp = tupleParts(param[2])
    if (tp) return [{ kind: 'param', name: param[1], comps: tp, src }]
  }

  // Points: A(1, 2) / A = (1, 2, 3)
  const point = src.match(/^([A-Z][0-9']*)\s*=?\s*(\(.+\))$/)
  if (point) {
    const tp = tupleParts(point[2])
    if (tp) return [{ kind: 'point', name: point[1], coords: tp, src }]
  }

  // Vectors need an explicit definition: 𝐚 = (1, 2) (typed as **a** = …), or AB = (1, 2)
  const vec = src.match(new RegExp(`^(${BOLD_NAME}|[A-Z]{2})\\s*=\\s*(\\(.+\\))$`, 'u'))
  if (vec) {
    const tp = tupleParts(vec[2])
    if (tp) return [{ kind: 'vector', name: unbold(vec[1]), comps: tp, src }]
  }
  const plainVec = src.match(/^([a-z])(_\w+)?\s*=\s*(\(.+\))$/)
  if (plainVec && tupleParts(plainVec[3]))
    return [err(src, `向量要用粗体定义：**${plainVec[1]}** = ${plainVec[3]}（也可写 ${bold(plainVec[1])}、\\mathbf{${plainVec[1]}} 或 \\vec{${plainVec[1]}}）`)]
  const lowerPoint = src.match(/^([a-z])\s*(\(.+\))$/)
  if (lowerPoint && tupleParts(lowerPoint[2]) && !(vars(src) ?? []).length)
    return [err(src, `点用大写字母命名，例如 ${lowerPoint[1].toUpperCase()}${lowerPoint[2]}；向量请写 **${lowerPoint[1]}** = ${lowerPoint[2]}`)]

  // derived points: M = 中点(A, B) / M = midpoint(A, B)
  const midDef = src.match(/^([A-Z][0-9']*)\s*=\s*(?:中点|midpoint)\s*\(\s*([A-Z][0-9']*)\s*,\s*([A-Z][0-9']*)\s*\)$/)
  if (midDef) return [{ kind: 'pointDef', name: midDef[1], a: midDef[2], b: midDef[3], m: null, n: null, src }]
  // section points: P = 分点(A, B, 1:2) — AP : PB = 1 : 2 (a bare number λ means AP : PB = λ : 1)
  const sectDef = src.match(/^([A-Z][0-9']*)\s*=\s*(?:分点|定比分点|section)\s*\(\s*([A-Z][0-9']*)\s*,\s*([A-Z][0-9']*)\s*,\s*([^)]+?)\s*\)$/)
  if (sectDef) {
    const ratio = sectDef[4].match(/^([0-9.]+)(?:\s*[:：]\s*([0-9.]+))?$/)
    if (!ratio) return [err(src, '分点的比写成 1:2（表示 AP : PB = 1 : 2）')]
    return [{ kind: 'pointDef', name: sectDef[1], a: sectDef[2], b: sectDef[3], m: ratio[1], n: ratio[2] ?? null, src }]
  }
  // derived vectors: 𝐩 = 投影(𝐚, 𝐛), 𝐜 = 𝐚 + 𝐛, 𝐜 = 𝐚 − 𝐛
  const projDef = src.match(new RegExp(`^(${BOLD_NAME})\\s*=\\s*(?:投影|proj)\\s*\\(\\s*(${BOLD_NAME})\\s*,\\s*(${BOLD_NAME})\\s*\\)$`, 'u'))
  if (projDef) return [{ kind: 'vectorDef', name: unbold(projDef[1]), op: 'proj', a: unbold(projDef[2]), b: unbold(projDef[3]), src }]
  const vecOp = src.match(new RegExp(`^(${BOLD_NAME})\\s*=\\s*(${BOLD_NAME})\\s*([+\\-])\\s*(${BOLD_NAME})$`, 'u'))
  if (vecOp) return [{ kind: 'vectorDef', name: unbold(vecOp[1]), op: vecOp[3] === '+' ? 'sum' : 'sub', a: unbold(vecOp[2]), b: unbold(vecOp[4]), src }]

  // bare tuple → anonymous point
  const bare = tupleParts(src)
  if (bare) return [{ kind: 'point', name: '', coords: bare, src }]

  // |AB| = 5, AB = 5, |a| = 3
  const len = src.match(new RegExp(`^(\\|(?:${BOLD_NAME}|[A-Za-z](?:_\\w+)?[A-Z]?)\\||[A-Z][A-Z])\\s*=\\s*(.+)$`, 'u'))
  if (len) {
    const ref = parseRef(len[1])
    if (ref) return [{ kind: 'constraint', c: { type: 'len', ref, value: len[2] }, src }]
  }

  const sides = splitTop(src, ['='])
  if (sides.length > 2) return [err(src, '一个式子里只能有一个等号')]

  if (sides.length === 1) {
    const v = vars(src)
    if (!v) return [err(src, engine.inspect(src).error ?? '无法解析')]
    if (v.includes('z')) return [{ kind: 'implicit3', F: src, src: `${src} = 0` }]
    if (v.includes('y')) return [{ kind: 'surface', expr: src, src: `z = ${src}` }]
    return [{ kind: 'curve', expr: src, src: `y = ${src}` }]
  }

  const [lhs, rhs] = sides
  const lhsT = lhs.replace(/\s+/g, '')

  // f(2) = 5, f'(1) = 0
  const fcall = lhsT.match(/^([a-z])('?)\((.+)\)$/)
  if (fcall && fcall[3] !== 'x' && !/^x,y$/.test(fcall[3])) {
    return [{ kind: 'constraint', c: { type: 'fcall', fname: fcall[1], deriv: fcall[2] === "'", arg: fcall[3], value: rhs }, src }]
  }

  const named = lhsT.match(/^([a-zA-Z](?:_\w+)?)\((x|x,y)\)$/)
  if (lhsT === 'y' || (named && named[2] === 'x')) {
    const v = vars(rhs)
    if (!v) return [err(src, engine.inspect(rhs).error ?? '无法解析')]
    const name = named ? named[1] : undefined
    if (v.includes('y')) return [{ kind: 'implicit2', name, F: `(${lhs}) - (${rhs})`, src }]
    if (v.includes('z')) return [{ kind: 'implicit3', name, F: `(${lhsT === 'y' ? 'y' : lhs}) - (${rhs})`, src }]
    return [{ kind: 'curve', name, expr: rhs, src }]
  }
  if (lhsT === 'z' || (named && named[2] === 'x,y')) {
    const v = vars(rhs)
    if (!v) return [err(src, engine.inspect(rhs).error ?? '无法解析')]
    if (v.includes('z')) return [{ kind: 'implicit3', F: `(z) - (${rhs})`, src }]
    // z = c (no x/y) is the horizontal plane; keep it as implicit3 so plane tools apply.
    if (v.length === 0) return [{ kind: 'implicit3', F: `(z) - (${rhs})`, src }]
    return [{ kind: 'surface', name: named ? named[1] : undefined, expr: rhs, src }]
  }

  const F = `(${lhs}) - (${rhs})`
  const v = vars(F)
  if (!v) {
    const e = engine.inspect(lhs).ok ? engine.inspect(rhs).error : engine.inspect(lhs).error
    return [err(src, e ?? '无法解析')]
  }
  if (v.includes('z')) return [{ kind: 'implicit3', F, src }]
  // `x = 3` is the vertical line; any other equation in x alone is something to solve.
  const verticalLine = lhsT === 'x' && !(vars(rhs) ?? []).includes('x')
  if (v.includes('x') && !v.includes('y') && !verticalLine) return [{ kind: 'equation1', F, lhs, rhs, src }]
  if (v.includes('x') || v.includes('y')) return [{ kind: 'implicit2', F, src }]
  if (v.length === 0) return [err(src, '这是一个纯数字等式，没有可画的对象')]
  return [{ kind: 'constraint', c: { type: 'equation', F }, src }]
}

function parseTriangle(line: string): Statement | null {
  const m = line.match(TRI_RE)
  if (!m) return null
  const names = m[1] ?? 'ABC'
  const lower = names.toLowerCase()
  const known: Record<string, string> = {}
  const body = m[2].replace(/∠/g, '')
  for (const raw of body.split(/[,;\s]+(?=[A-Za-z][A-Za-z_]*\s*=|S\s*=)/)) {
    const kv = raw.split('=')
    if (kv.length !== 2) continue
    const k = kv[0].trim().replace(/[,;]/g, '')
    const v = kv[1].trim().replace(/[,;]$/, '')
    if (!v) continue
    let key: string | null = null
    if (k === 'S' || k === 'area') key = 'S'
    else if (/^m[_\s]*([abc])$/i.test(k)) key = `m${/^m[_\s]*([abc])$/i.exec(k)![1].toLowerCase()}`
    else if (/^h[_\s]*([abc])$/i.test(k)) key = `h${/^h[_\s]*([abc])$/i.exec(k)![1].toLowerCase()}`
    else if (names.includes(k)) key = 'ABC'[names.indexOf(k)]
    else if (lower.includes(k)) key = 'abc'[lower.indexOf(k)]
    if (key) known[key] = v
  }
  if (!Object.keys(known).length) return { kind: 'error', message: '三角形请写成 △ABC: a=3, b=4, C=90°（也支持 m_a、h_a、面积 S）', src: line }
  return { kind: 'triangle', names, known, src: line }
}

/** Display name for a triangle known-key: a, A, S, m_a, h_c … */
export function triKeyLatex(k: string, names: string): string {
  if (k === 'S') return 'S'
  if (/^[ABC]$/.test(k)) return `\\angle ${names['ABC'.indexOf(k)]}`
  const mm = k.match(/^m([abc])$/)
  if (mm) return `m_{${mm[1]}}`
  const hh = k.match(/^h([abc])$/)
  if (hh) return `h_{${hh[1]}}`
  return names.toLowerCase()['abc'.indexOf(k)] ?? k
}

// ---------------------------------------------------------------------------
// Circles and chord problems (line level, because the body carries commas)

const CIRCLE_RE = /^(?:⊙|◯|○|⭕|圆|circle)\s*([A-Z])?\s*[:：]?\s*(.*)$/i
/** 弦 AB、CD 交于 P / 割线 AB、CD 交于 P / AB ∩ CD = P */
const CHORDS_RE = /^(弦|割线)?\s*([A-Z])([A-Z])\s*(?:[、,]|和|与|and)?\s*(弦|割线)?\s*([A-Z])([A-Z])\s*(?:交于点|交于|相交于|∩)\s*=?\s*([A-Z])\s*[:：]?\s*(.*)$/
/** 切线 PT、割线 PAB */
const TANGENT_RE = /^切线\s*([A-Z])([A-Z])\s*(?:[、,]|和|与)?\s*(?:割线\s*)?([A-Z])([A-Z])([A-Z])\s*[:：]?\s*(.*)$/

function parseChordLine(line: string): Statement {
  const tan = line.match(TANGENT_RE)
  if (tan) {
    const p = tan[1]
    if (tan[3] !== p) return { kind: 'error', message: `切线 ${tan[1]}${tan[2]} 和割线 ${tan[3]}… 要从同一点出发，例如 切线 PT、割线 PAB`, src: line }
    const lengths: Record<string, string> = {}
    for (const item of splitTop(tan[6], [','])) {
      const kv = item.match(/^\|?\s*([A-Z])\s*([A-Z])\s*\|?\s*=\s*(.+)$/)
      if (kv) lengths[`${kv[1]}${kv[2]}`] = kv[3].trim()
    }
    return { kind: 'chords', p, chords: [[tan[2]], [tan[4], tan[5]]], lengths, pos: 'tan', src: line }
  }
  const m = line.match(CHORDS_RE)
  if (!m) {
    return { kind: 'error', message: '弦的写法：弦 AB、CD 交于 P, PA = 2, PB = 6, PC = 4（或 切线 PT、割线 PAB）', src: line }
  }
  const pos0 = m[1] ?? m[4]
  let pos: 'in' | 'out' | null = pos0 === '割线' ? 'out' : pos0 === '弦' ? 'in' : null
  const p = m[7]
  if (p === m[2] || p === m[3] || p === m[5] || p === m[6])
    return { kind: 'error', message: `交点 ${p} 不能同时是弦的端点`, src: line }
  const lengths: Record<string, string> = {}
  let marker: 'in' | 'out' | null = null
  for (const item of splitTop(m[8], [','])) {
    const t = item.trim()
    const kv = t.match(/^\|?\s*([A-Z])\s*([A-Z])\s*\|?\s*=\s*(.+)$/)
    if (kv) {
      lengths[`${kv[1]}${kv[2]}`] = kv[3].trim()
      continue
    }
    const where = t.match(/^(?:([A-Z])\s*)?在?\s*圆\s*(内|外)$/)
    if (where) marker = where[2] === '内' ? 'in' : 'out'
  }
  if (marker) pos = marker
  return { kind: 'chords', p, chords: [[m[2], m[3]], [m[5], m[6]]], lengths, pos, src: line }
}

function parseCircleLine(line: string): Statement | null {
  const m = line.match(CIRCLE_RE)
  if (!m) return null
  const name = m[1] ?? 'O'
  const body = m[2].trim()
  if (!body) return { kind: 'error', message: '圆的写法：⊙O: r = 5', src: line }
  let radius: string | null = null
  const through: { coords: string[] | null; point: string | null }[] = []
  for (const item of splitTop(body, [','])) {
    const t = item.trim()
    if (!t) continue
    const rr = t.match(/^(?:r|R|半径|radius)\s*=\s*(.+)$/)
    if (rr) {
      radius = rr[1].trim()
      continue
    }
    const th = t.match(/^(?:过|经过|through|passes|pass)\s*(?:点)?\s*(.+)$/i)
    if (th) {
      const tp = tupleParts(th[1])
      if (tp) through.push({ coords: tp, point: null })
      else if (/^[A-Z]$/.test(th[1].trim())) through.push({ coords: null, point: th[1].trim() })
      else return { kind: 'error', message: '“过”后面写点坐标，例如 ⊙O: 过(3, 4)', src: line }
      continue
    }
    return { kind: 'error', message: `看不懂圆里的「${t}」：写 r = 5 或 过(3, 4)，点请单独一行写 A(3, 4)`, src: line }
  }
  if (!radius && !through.length) return { kind: 'error', message: '圆的写法：⊙O: r = 5 或 ⊙O: 过(3, 4)', src: line }
  return { kind: 'circle', name, center: m[1] ?? null, radius, through, src: line }
}

/** Try the line-level geometric forms (triangle / circle / chords) before comma splitting. */
function parseLine(line: string): Statement | null {
  const tri = parseTriangle(line)
  if (tri) return tri
  if (TANGENT_RE.test(line)) return parseChordLine(line)
  if (CHORDS_RE.test(line) && !CIRCLE_RE.test(line)) return parseChordLine(line)
  if (/^(?:⊙|◯|○|⭕|圆|circle)/i.test(line)) return parseCircleLine(line)
  return null
}

/** Parse a card's text into statements (one per line / `;` / top-level comma). */
export function parseCard(text: string): Statement[] {
  const out: Statement[] = []
  const lines = normalize(text)
    .split(/\n/)
    .flatMap((l) => splitTop(l, [';']))
  for (const line of lines) {
    const geo = parseLine(line)
    if (geo) {
      out.push(geo)
      continue
    }
    for (const part of splitTop(line, [','])) out.push(...classifyPart(part))
  }
  return out
}

// ---------------------------------------------------------------------------
// LaTeX for statements

function refLatex(r: Ref) {
  return r.kind === 'seg' ? `\\overrightarrow{${r.p}${r.q}}` : `\\mathbf{${r.name}}`
}

function exprLatex(src: string) {
  return engine.latex(src)
}

function angleValueLatex(v: string) {
  return /°|pi|π/.test(v) ? exprLatex(v) : `${exprLatex(v)}^{\\circ}`
}

export function statementLatex(s: Statement): string {
  switch (s.kind) {
    case 'triangle': {
      const parts = Object.entries(s.known).map(([k, v]) => `${triKeyLatex(k, s.names)} = ${/[ABC]/.test(k) ? angleValueLatex(v) : exprLatex(v)}`)
      return `\\triangle ${s.names}:\\ ${parts.join(',\\ ')}`
    }
    case 'pointDef':
      return s.m == null
        ? `${s.name} = \\text{中点}\\left(${s.a},\\ ${s.b}\\right)`
        : `${s.name} = \\text{分点}\\left(${s.a},\\ ${s.b},\\ ${exprLatex(s.m)}${s.n != null ? `:${exprLatex(s.n)}` : ''}\\right)`
    case 'vectorDef': {
      const nm = (x: string) => (/^[A-Z]{2}$/.test(x) ? `\\overrightarrow{${x}}` : `\\mathbf{${x}}`)
      return s.op === 'proj'
        ? `${nm(s.name)} = \\text{proj}\\left(${nm(s.a)},\\ ${nm(s.b)}\\right)`
        : `${nm(s.name)} = ${nm(s.a)} ${s.op === 'sum' ? '+' : '-'} ${nm(s.b)}`
    }
    case 'point':
      return `${s.name ? s.name : ''}\\left(${s.coords.map(exprLatex).join(',\\ ')}\\right)`
    case 'vector':
      return `${/^[A-Z]{2}$/.test(s.name) ? `\\overrightarrow{${s.name}}` : `\\mathbf{${s.name}}`} = \\left(${s.comps.map(exprLatex).join(',\\ ')}\\right)`
    case 'param':
      return `\\vec{${s.name}}(t) = \\left(${s.comps.map(exprLatex).join(',\\ ')}\\right)`
    case 'circle': {
      const parts: string[] = []
      if (s.radius) parts.push(`r = ${exprLatex(s.radius)}`)
      for (const th of s.through) parts.push(`\\text{过 } ${th.point ?? `\\left(${(th.coords ?? []).map(exprLatex).join(',\\ ')}\\right)`}`)
      return `\\odot ${s.name}:\\ ${parts.join(',\\ ')}`
    }
    case 'chords': {
      const lens = Object.entries(s.lengths).map(([k, v]) => `${k} = ${exprLatex(v)}`)
      const head =
        s.chords[0].length === 1
          ? `${s.p}${s.chords[0][0]} \\text{ 为切线},\\ ${s.p}${s.chords[1][0]}${s.chords[1][1]} \\text{ 为割线}`
          : `${s.chords[0][0]}${s.chords[0][1]} \\cap ${s.chords[1][0]}${s.chords[1][1]} = ${s.p}`
      return `${head}${lens.length ? `:\\ ${lens.join(',\\ ')}` : ''}`
    }
    case 'constraint': {
      const c = s.c
      switch (c.type) {
        case 'perp':
          return `${refLatex(c.a)} \\perp ${refLatex(c.b)}`
        case 'para':
          return `${refLatex(c.a)} \\parallel ${refLatex(c.b)}`
        case 'len':
          return `\\left|${refLatex(c.ref)}\\right| = ${exprLatex(c.value)}`
        case 'angle':
          return `\\angle ${c.p}${c.q}${c.r} = ${angleValueLatex(c.value)}`
        case 'through':
          return `\\text{过 } ${c.point ?? `\\left(${(c.coords ?? []).map(exprLatex).join(',\\ ')}\\right)`}`
        case 'fcall':
          return `${c.fname}${c.deriv ? "'" : ''}\\left(${exprLatex(c.arg)}\\right) = ${exprLatex(c.value)}`
        case 'equation':
          return exprLatex(s.src)
      }
      return exprLatex(s.src)
    }
    case 'curve':
      return `${s.name ? `${s.name}\\left(x\\right)` : 'y'} = ${exprLatex(s.expr)}`
    case 'surface':
      return `${s.name ? `${s.name}\\left(x,\\ y\\right)` : 'z'} = ${exprLatex(s.expr)}`
    case 'equation1':
      return `${exprLatex(s.lhs)} = ${exprLatex(s.rhs)}`
    case 'notation':
      return s.latex
    case 'error':
      return `\\text{${s.src.replace(/[\\{}$&#%_^]/g, ' ')}}`
    default:
      return exprLatex(s.src)
  }
}

export function kindLabel(s: Statement): string {
  switch (s.kind) {
    case 'curve':
      return '函数'
    case 'implicit2':
      return '平面曲线'
    case 'equation1':
      return '方程'
    case 'surface':
      return '空间曲面'
    case 'implicit3':
      return '空间方程'
    case 'point':
      return '点'
    case 'vector':
      return '向量'
    case 'param':
      return '参数曲线'
    case 'triangle':
      return '解三角形'
    case 'circle':
      return '圆'
    case 'chords':
      return '圆中的弦'
    case 'pointDef':
      return '定义点'
    case 'vectorDef':
      return '定义向量'
    case 'constraint':
      return '条件'
    case 'notation':
      if (s.latex === '\\sigma') return '符号'
      return s.latex.includes('\\int') && !s.latex.includes('\\sum') ? '积分' : '求和'
    case 'error':
      return '待修正'
  }
}
