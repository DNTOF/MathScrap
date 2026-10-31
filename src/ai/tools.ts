import type { Card, Doc } from '@/board/types'
import { analyze } from '@/math/scene'
import { emphasizeVectors } from './formulas'
import { normalizePlotInput, type PlotViewInput } from '@/plot/remoteView'
import { TOOL_SPECS } from './specs'

export { TOOL_SPECS }

/**
 * Tool handlers run in the page. `window.mathscrap.tools` and the dev-server
 * bridge both call `createToolBridge(...).call`.
 */
export interface ToolHost {
  getDoc: () => Doc
  addCard: (text: string, x?: number, y?: number) => Card
  updateCard: (id: string, text: string) => void
  openPlot: (id?: string) => void
  setPlotView: (input: PlotViewInput) => unknown
}

export function createToolBridge(host: ToolHost) {
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    page_read: () => {
      const d = host.getDoc()
      return { formulas: d.cards.map((c) => ({ id: c.id, text: c.text, x: c.x, y: c.y })), strokes: d.strokes.length }
    },
    page_add_formula: (a) => {
      const text = emphasizeVectors(String(a.text ?? '')).trim()
      if (!text) return { error: '公式是空的' }
      return host.addCard(text, finite(a.x), finite(a.y))
    },
    page_update_formula: (a) => {
      const text = emphasizeVectors(String(a.text ?? '')).trim()
      if (!text) return { error: '公式是空的' }
      host.updateCard(String(a.id ?? ''), text)
      return { ok: true, id: String(a.id ?? ''), text }
    },
    solve_analyze: (a) => {
      const texts = (Array.isArray(a.texts) ? a.texts : []).map((text) => emphasizeVectors(String(text)))
      const r = analyze(texts.map((text, i) => ({ id: String(i), text })))
      return {
        dim: r.dim,
        solve: r.solve,
        sections: r.sections.map((s) => ({ title: s.title, facts: s.facts.map((f) => ({ label: f.label, value: f.value, why: f.why })) })),
        errors: r.errors,
      }
    },
    plot_open: (a) => (host.openPlot(a.id ? String(a.id) : undefined), { ok: true }),
    plot_set_view: (a) => {
      const norm = normalizePlotInput(a)
      if (!norm.ok) return { error: norm.error }
      return { ok: true, view: host.setPlotView(norm.value) }
    },
    ink_read: (a) => {
      const since = typeof a.since === 'number' && Number.isFinite(a.since) ? a.since : -Infinity
      const requested = typeof a.limit === 'number' && Number.isFinite(a.limit) ? a.limit : 40
      const limit = Math.min(200, Math.max(1, Math.floor(requested)))
      const all = host.getDoc().strokes.filter((s) => s.createdAt > since)
      const strokes = all.slice(-limit)
      return {
        total: host.getDoc().strokes.length,
        matched: all.length,
        returned: strokes.length,
        strokes: strokes.map((s) => ({
          id: s.id,
          pts: s.pts,
          color: s.color,
          width: s.width,
          style: s.style,
          recognized: !!s.recognized,
          createdAt: s.createdAt,
          points: Math.floor(s.pts.length / 3),
        })),
      }
    },
  }
  return {
    specs: TOOL_SPECS,
    call(name: string, args: Record<string, unknown> = {}) {
      const handler = handlers[name]
      if (!handler) return { error: `未知工具 ${name}` }
      try {
        return handler(args)
      } catch (e) {
        return { error: e instanceof Error ? e.message : '工具执行失败' }
      }
    },
  }
}

function finite(v: unknown) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}
