import { Eye, EyeOff, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import type { Card } from '@/board/types'
import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { pageGroups } from '@/math/page'
import { analyze } from '@/math/scene'
import type { RustShape } from '@/wasm/engine'
import { FactsPanel, factKey } from './FactsPanel'
import { buildFigure2d, buildFigure3d, initialRanges, type Ranges } from './figure'
import { PlotView } from './PlotView'

interface Props {
  cards: Card[]
  open: boolean
  /** formula the plot was opened from — decides plane vs space when the sheet has both */
  focusId: string | null
  onClose: () => void
}

/**
 * The sheet's one shared coordinate system: every formula on the paper is drawn on the same
 * axes and analysed together (intersections, unknowns, geometry). Plane and space formulas
 * get one shared system each.
 */
export function PlotPanel({ cards, open, focusId, onClose }: Props) {
  const groups = useMemo(() => pageGroups(cards), [cards])
  const [mode, setMode] = useState<2 | 3>(2)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [solution, setSolution] = useState(0)
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [ranges, setRanges] = useState<Ranges | null>(null)

  useEffect(() => {
    if (!open) return
    const focus = groups.entries.find((e) => e.card.id === focusId)
    setMode(focus ? focus.dim : groups.count[2] || !groups.count[3] ? 2 : 3)
    setHidden((h) => new Set([...h].filter((id) => cards.some((c) => c.id === id) && id !== focusId)))
    setSolution(0)
    setVisible(new Set())
    setRanges(null)
    // re-initialise each time the panel opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusId])

  const entries = useMemo(() => groups.entries.filter((e) => e.dim === mode), [groups, mode])
  const active = useMemo(() => entries.filter((e) => !hidden.has(e.card.id)), [entries, hidden])

  const analysis = useMemo(() => {
    if (!open || !active.length) return null
    return analyze(
      active.map((e) => ({ id: e.card.id, text: e.card.text })),
      solution,
    )
  }, [open, active, solution])

  const shapes = useMemo(() => {
    if (!analysis) return [] as RustShape[]
    const out: RustShape[] = []
    analysis.sections.forEach((s) => s.facts.forEach((f, i) => f.shape && visible.has(factKey(s.id, i)) && out.push(f.shape)))
    return out
  }, [analysis, visible])

  const objectKey = useMemo(() => (analysis ? `${analysis.dim}|${analysis.objects.map((o) => o.type + ('name' in o ? o.name : '')).join(',')}|${solution}` : ''), [analysis, solution])

  const base = useMemo(() => (analysis && analysis.dim === 2 ? initialRanges(analysis) : null), [analysis])
  const figure = useMemo(() => {
    if (!analysis) return null
    if (analysis.dim === 3) return buildFigure3d(analysis, shapes)
    return buildFigure2d(analysis, ranges ?? base!, shapes)
  }, [analysis, shapes, ranges, base])

  useEffect(() => setRanges(null), [objectKey])

  const onRange = useCallback((x: [number, number], y: [number, number]) => {
    setRanges((r) => (r && Math.abs(r.x[0] - x[0]) < 1e-9 && Math.abs(r.x[1] - x[1]) < 1e-9 && Math.abs(r.y[0] - y[0]) < 1e-9 ? r : { x, y }))
  }, [])

  const toggle = <T,>(set: (f: (s: Set<T>) => Set<T>) => void, k: T) =>
    set((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const showAllShapes = () => {
    if (!analysis) return
    const all = new Set<string>()
    analysis.sections.forEach((s) => s.facts.forEach((f, i) => f.shape && all.add(factKey(s.id, i))))
    setVisible((v) => (v.size === all.size ? new Set() : all))
  }

  const both = groups.count[2] > 0 && groups.count[3] > 0
  const drawn = active.filter((e) => !e.condition).length
  const conditions = active.length - drawn

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-kraft-800/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup
          className="kraft-panel fixed inset-0 z-50 flex flex-col overflow-hidden outline-none transition-all data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 sm:inset-3 sm:rounded-3xl lg:inset-6"
          data-no-board
          data-plot-mode={mode}
        >
          <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="hand text-[26px] leading-none font-bold text-kraft-800">{mode === 3 ? '空间直角坐标系' : '平面直角坐标系'}</DialogPrimitive.Title>
              <p className="mt-1 truncate text-[12px] text-kraft-700">
                纸上 {drawn} 个式子{conditions ? ` + ${conditions} 个条件` : ''}画在同一坐标系里
                {analysis && ` · ${mode === 3 ? '拖动旋转，滚轮 / 双指缩放' : '拖动平移，缩放后由 Rust 重新采样'}`}
              </p>
            </div>
            {both && (
              <div className="flex rounded-full bg-kraft-800/10 p-0.5 text-[12.5px]" role="tablist" aria-label="坐标系">
                {([2, 3] as const).map((d) => (
                  <button key={d} role="tab" aria-selected={mode === d} onClick={() => setMode(d)} className={cn('h-8 rounded-full px-3 transition', mode === d ? 'bg-kraft-50 text-kraft-800 shadow-sm' : 'text-kraft-700 hover:text-kraft-800')}>
                    {d === 2 ? '平面' : '空间'} · {groups.count[d]}
                  </button>
                ))}
              </div>
            )}
            <DialogPrimitive.Close className="touch-target grid size-9 place-items-center rounded-full text-kraft-700 hover:bg-kraft-800/10" aria-label="关闭">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>

          {entries.length > 1 && (
            <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2" aria-label="纸上的式子">
              {entries.map((e) => {
                const off = hidden.has(e.card.id)
                return (
                  <button
                    key={e.card.id}
                    onClick={() => toggle(setHidden, e.card.id)}
                    aria-pressed={!off}
                    aria-label={e.card.text}
                    title={off ? '放回坐标系' : '暂时从坐标系拿掉'}
                    className={cn('touch-target flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[14px] transition', off ? 'border-dashed border-kraft-800/25 opacity-45' : 'border-kraft-800/20 bg-kraft-50/50 hover:bg-kraft-50')}
                  >
                    {off ? <EyeOff className="size-3.5 text-kraft-700" /> : <Eye className="size-3.5 text-kraft-700" />}
                    <span className={cn(off && 'line-through')}>
                      <Tex tex={e.summary.lines[0]?.latex ?? ''} />
                    </span>
                    {e.summary.lines.length > 1 && <span className="text-[10px] text-kraft-700">+{e.summary.lines.length - 1}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {analysis && figure ? (
            <div className="flex min-h-0 flex-1 flex-col border-t border-kraft-800/10 lg:flex-row">
              <div className="relative h-[48dvh] shrink-0 border-b border-kraft-800/10 p-1 sm:h-[52dvh] lg:h-auto lg:flex-1 lg:border-r lg:border-b-0">
                <PlotView data={figure.data} layout={figure.layout} onRange={analysis.dim === 2 ? onRange : undefined} resetKey={objectKey} />
                {analysis.sections.some((s) => s.facts.some((f) => f.shape)) && (
                  <button onClick={showAllShapes} className="paper-chrome touch-target absolute bottom-3 left-3 flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-kraft-800">
                    <Sparkles className="size-3.5 text-[#b9852a]" />
                    {visible.size ? '收起推导标注' : '在图上标出全部推导'}
                  </button>
                )}
              </div>
              <aside className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 lg:w-[420px] lg:flex-none xl:w-[460px]">
                <FactsPanel analysis={analysis} visible={visible} onToggleShape={(k) => toggle(setVisible, k)} onPickSolution={setSolution} />
              </aside>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center border-t border-kraft-800/10 p-8 text-center text-kraft-800/75">
              <div>
                <div className="hand text-[30px] font-bold">{entries.length ? '式子都先拿掉了' : '纸上还没有能画的式子'}</div>
                <p className="mt-1 text-[13px]">{entries.length ? '点上面的式子把它放回坐标系。' : '在纸上写一个函数、方程或几何条件，再回来看。'}</p>              </div>
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
