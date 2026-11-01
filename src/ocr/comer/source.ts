import { isCompleteExpression, repairLatex } from './repair.ts'

export interface Vocab {
  word2idx: Record<string, number>
  idx2word: Record<string, string>
  special_tokens: { pad: number; sos: number; eos: number }
  vocab_size: number
}

export function vocabFromJson(raw: unknown): Vocab {
  const v = raw as Vocab
  if (!v?.idx2word || !v.special_tokens || !v.vocab_size) throw new Error('词表格式不对')
  return v
}

export function decodeTokens(ids: number[], vocab: Vocab): string[] {
  const skip = new Set([vocab.special_tokens.pad, vocab.special_tokens.sos, vocab.special_tokens.eos])
  const words: string[] = []
  for (const id of ids) {
    if (skip.has(id)) continue
    const word = vocab.idx2word[String(id)]
    if (word) words.push(word)
  }
  return words
}

const NAMED: Record<string, string> = {
  '\\alpha': 'alpha',
  '\\beta': 'beta',
  '\\gamma': 'gamma',
  '\\lambda': 'lambda',
  '\\mu': 'mu',
  '\\phi': 'phi',
  '\\pi': 'pi',
  '\\sigma': 'sigma',
  '\\theta': 'theta',
}

/**
 * CoMER tokens → the ASCII this sheet already parses.
 * `a ^ { 2 } = b` becomes `a^2 = b`. `\vec{a}` stays an arrowed letter.
 * `\sum_{i=1}^{n} i` keeps braced LaTeX (including a `\limits` the model inserts) so KaTeX can show it.
 * `\sigma` / `\pi` / `\theta` become the names the sheet already parses.
 * A component tuple is kept only when the model actually emitted parentheses.
 */
export function tokensToSource(tokens: string[]): string {
  const repaired = repairLatex(tokens)
  if (!isCompleteExpression(repaired)) return ''
  let i = 0
  const readGroup = (): string => {
    if (repaired[i] !== '{') return readAtom()
    i++
    let body = ''
    let depth = 1
    while (i < repaired.length && depth > 0) {
      if (repaired[i] === '{') depth++
      else if (repaired[i] === '}') {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
      body += readAtom()
    }
    return body
  }
  /** Keep braces around a group so ∑ / ∫ limits stay valid LaTeX. */
  const readLatexGroup = (): string => {
    if (repaired[i] !== '{') return readAtom()
    return `{${readGroup()}}`
  }
  const readAtom = (): string => {
    const cur = repaired[i++]
    if (!cur || cur === '{' || cur === '}') return ''
    if (cur === '\\frac') return `(${readGroup()})/(${readGroup()})`
    if (cur === '\\sqrt') return `sqrt(${readGroup()})`
    if (cur === '\\vec' || cur === '\\overrightarrow') return `\\vec{${readGroup()}}`
    if (cur === '\\sum' || cur === '\\int') {
      let out = cur
      const take = (mark: '_' | '^') => {
        let j = i
        if (repaired[j] === '\\limits') j++
        if (repaired[j] !== mark) return
        i = j + 1
        out += mark + readLatexGroup()
      }
      take('_')
      take('^')
      if (!out.includes('_')) take('_')
      if (i >= repaired.length) return out
      const body = repaired[i] === '{' ? readLatexGroup() : readAtom()
      if (body.trim()) out += ` ${body.trim()}`
      return out
    }
    if (cur === '^') return `^${readGroup()}`
    if (cur === '_') return `_${readGroup()}`
    if (cur === '\\cdot' || cur === '\\times') return ''
    if (cur === '=' || cur === '+' || cur === '-') return ` ${cur} `
    if (NAMED[cur]) return NAMED[cur]
    return cur
  }
  let out = ''
  while (i < repaired.length) out += readAtom()
  const compact = out.replace(/\s+/g, ' ').trim()
  if (!/[0-9A-Za-z\\]/.test(compact)) return ''
  return compact
}
