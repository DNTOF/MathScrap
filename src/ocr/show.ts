import { summarizeCard } from '@/math/scene'

/** LaTeX for the confirm chip. A lone `\vec{a}` stays an arrow, not a parse error. */
export function candidateLatex(text: string): string {
  const raw = text.trim()
  if (/^\\vec\{[a-z]\}$/.test(raw)) return raw
  const line = summarizeCard(raw).lines[0]
  if (!line) return raw
  if (line.error && raw.includes('\\vec')) return raw
  return line.latex || raw
}