export interface Snippet {
  id: string
  /** LaTeX shown on palette buttons and in the background cheat-sheet */
  label: string
  /** inserted text; □ marks placeholders (Tab jumps between them) */
  insert: string
  /** KeyboardEvent.code used with Alt / ⌥ (or Ctrl/⌘ when `mod` is set) */
  code?: string
  mod?: boolean
  keyLabel?: string
  hint: string
  group: 'basic' | 'func' | 'geo' | 'struct'
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const ALT = isMac ? '⌥' : 'Alt'
export const MOD = isMac ? '⌘' : 'Ctrl'

export const SNIPPETS: Snippet[] = [
  { id: 'frac', label: '\\frac{a}{b}', insert: '(□)/(□)', code: 'Slash', mod: true, hint: '分数', group: 'basic' },
  { id: 'sq', label: 'x^2', insert: '^2', code: 'Digit2', hint: '平方', group: 'basic' },
  { id: 'pow', label: 'x^{n}', insert: '^(□)', code: 'Digit6', hint: '幂 / 指数', group: 'basic' },
  { id: 'sqrt', label: '\\sqrt{x}', insert: 'sqrt(□)', code: 'KeyR', hint: '根号', group: 'basic' },
  { id: 'abs', label: '|x|', insert: '|□|', code: 'KeyA', hint: '绝对值', group: 'basic' },
  { id: 'pi', label: '\\pi', insert: 'pi', code: 'KeyP', hint: '圆周率', group: 'basic' },
  { id: 'theta', label: '\\theta', insert: 'theta', code: 'KeyT', hint: 'θ', group: 'basic' },
  { id: 'deg', label: '30^{\\circ}', insert: '°', code: 'KeyO', hint: '角度 °', group: 'basic' },
  { id: 'sin', label: '\\sin', insert: 'sin(□)', code: 'KeyS', hint: '正弦', group: 'func' },
  { id: 'cos', label: '\\cos', insert: 'cos(□)', code: 'KeyC', hint: '余弦', group: 'func' },
  { id: 'tan', label: '\\tan', insert: 'tan(□)', hint: '正切', group: 'func' },
  { id: 'ln', label: '\\ln', insert: 'ln(□)', code: 'KeyL', hint: '自然对数', group: 'func' },
  { id: 'exp', label: 'e^{x}', insert: 'e^(□)', code: 'KeyE', hint: '指数', group: 'func' },
  { id: 'vec3', label: '\\mathbf{v}{=}(a,b,c)', insert: '**□** = (□, □, □)', code: 'KeyV', hint: '空间向量（名字用粗体）', group: 'struct' },
  { id: 'vec2', label: '\\mathbf{v}{=}(a,b)', insert: '**□** = (□, □)', code: 'KeyW', hint: '平面向量（名字用粗体）', group: 'struct' },
  { id: 'bold', label: '\\mathbf{a}', insert: '**□**', code: 'KeyB', hint: '粗体向量名，如 **a** ⊥ **b**', group: 'struct' },
  { id: 'point', label: 'A(x,y)', insert: '□(□, □)', code: 'KeyQ', hint: '点（大写字母命名）', group: 'struct' },
  { id: 'through', label: '\\text{过}(p,q)', insert: ', 过(□, □)', code: 'KeyH', hint: '曲线过某点', group: 'struct' },
  { id: 'tri', label: '\\triangle ABC', insert: '△ABC: a = □, b = □, C = □°', code: 'KeyD', hint: '解三角形', group: 'geo' },
  { id: 'perp', label: '\\perp', insert: ' ⊥ ', code: 'KeyK', hint: '垂直（也可输入 _|_）', group: 'geo' },
  { id: 'para', label: '\\parallel', insert: ' ∥ ', code: 'KeyJ', hint: '平行（也可输入 //）', group: 'geo' },
  { id: 'angle', label: '\\angle', insert: '∠□ = □°', code: 'KeyG', hint: '角', group: 'geo' },
]

export function snippetKey(s: Snippet) {
  if (!s.code) return ''
  const key = s.code.replace(/^Key|^Digit/, '').replace('Slash', '/')
  return `${s.mod ? MOD : ALT} ${key}`
}

export function matchSnippet(e: KeyboardEvent | React.KeyboardEvent): Snippet | null {
  for (const s of SNIPPETS) {
    if (!s.code || e.code !== s.code) continue
    if (s.mod ? e.ctrlKey || e.metaKey : e.altKey && !e.ctrlKey && !e.metaKey) return s
  }
  return null
}

/**
 * Insert a snippet into a textarea value at the selection. Selected text fills the first □.
 * Returns the new value and the selection to apply (the next □, or after the insert).
 */
export function applySnippet(value: string, start: number, end: number, s: Snippet) {
  const selected = value.slice(start, end)
  let insert = s.insert
  if (selected && insert.includes('□')) insert = insert.replace('□', selected)
  const next = value.slice(0, start) + insert + value.slice(end)
  const ph = next.indexOf('□', start)
  if (ph >= 0 && ph < start + insert.length) return { value: next, selStart: ph, selEnd: ph + 1 }
  const pos = start + insert.length
  return { value: next, selStart: pos, selEnd: pos }
}

export function nextPlaceholder(value: string, from: number) {
  let i = value.indexOf('□', from)
  if (i < 0) i = value.indexOf('□')
  return i
}
