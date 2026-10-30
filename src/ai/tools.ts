import type { Card, Doc } from '@/board/types'
import { analyze } from '@/math/scene'

/**
 * Tool surface intended for a future MCP server / LLM function-calling.
 * The schemas are MCP-shaped (name, description, inputSchema). In this demo the
 * handlers run locally in the browser and are exposed as `window.mathscrap.tools`.
 */
export const TOOL_SPECS = [
  {
    name: 'page_read',
    description: '读取当前页：所有公式卡片（原文、位置）以及笔迹数量。',
    inputSchema: { type: 'object', properties: {} },
    status: 'local',
  },
  {
    name: 'page_add_formula',
    description: '在页面上新增一张公式卡片。text 使用本应用的 ASCII 数学写法，例如 "y = x^2 - 2" 或 "△ABC: a=3, b=4, C=90°"。',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['text'] },
    status: 'local',
  },
  {
    name: 'page_update_formula',
    description: '修改某张卡片的公式文本。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
    status: 'local',
  },
  {
    name: 'solve_analyze',
    description: '对一组公式 / 几何条件做推导：解未知量、求交点、解三角形等，返回结构化结果（由 Rust/WASM 计算）。',
    inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } }, required: ['texts'] },
    status: 'local',
  },
  {
    name: 'plot_open',
    description: '打开某张卡片的坐标系面板（自动选择 2D / 3D）。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    status: 'local',
  },
  {
    name: 'plot_set_view',
    description: '修改坐标系：坐标范围、3D 相机角度、叠加哪些对象。',
    inputSchema: { type: 'object', properties: { x: { type: 'array' }, y: { type: 'array' }, camera: { type: 'object' } } },
    status: 'planned',
  },
  {
    name: 'ink_read',
    description: '读取手写笔迹（点序列）供识别模型使用。',
    inputSchema: { type: 'object', properties: { since: { type: 'number' } } },
    status: 'planned',
  },
] as const

export interface ToolHost {
  getDoc: () => Doc
  addCard: (text: string, x?: number, y?: number) => Card
  updateCard: (id: string, text: string) => void
  openPlot: (id: string) => void
}

export function createToolBridge(host: ToolHost) {
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    page_read: () => {
      const d = host.getDoc()
      return { cards: d.cards.map((c) => ({ id: c.id, text: c.text, x: c.x, y: c.y })), strokes: d.strokes.length }
    },
    page_add_formula: (a) => host.addCard(String(a.text), a.x as number | undefined, a.y as number | undefined),
    page_update_formula: (a) => (host.updateCard(String(a.id), String(a.text)), { ok: true }),
    solve_analyze: (a) => {
      const r = analyze(((a.texts as string[]) ?? []).map((text, i) => ({ id: String(i), text })))
      return { dim: r.dim, solve: r.solve, sections: r.sections.map((s) => ({ title: s.title, facts: s.facts.map((f) => ({ label: f.label, value: f.value, why: f.why })) })), errors: r.errors }
    },
    plot_open: (a) => (host.openPlot(String(a.id)), { ok: true }),
  }
  return {
    specs: TOOL_SPECS,
    call(name: string, args: Record<string, unknown> = {}) {
      const h = handlers[name]
      if (!h) return { error: `工具 ${name} 尚未实现（规划中）` }
      return h(args)
    },
  }
}
