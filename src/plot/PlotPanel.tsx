import { Box, Layers, LineChart, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import type { Card } from '@/board/types'
import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { analyze, summarizeCard } from '@/math/scene'
import type { RustShape } from '@/wasm/engine'
import { FactsPanel, factKey } from './FactsPanel'
import { buildFigure2d, buildFigure3d, initialRanges, type Ranges } from './figure'
import { PlotView } from './PlotView'

interface Props {
  cards: Card[]
  primaryId: string | null
  onClose: () => void
}

/** Cards that are only curves/surfaces (no unknowns or geometry) overlay nicely by default. */
function overlayable(text: string, dim: 2 | 3) {
  const s = summarizeCard(text)
  if (!s.plottable || s.dim !== dim || s.hasUnknowns) return false
  return s.kinds.every((k) => k === 'curve' || k === 'implicit2' || k === 'implicit3' || k === 'surface')
}

export function PlotPanel({ cards, primaryId, onClose }: Props) {
  const open = !!primaryId
  const primary = cards.find((c) => c.id === primaryId) ?? null
  const primaryDim = primary ? summarizeCard(primary.text).dim : 2
  const [overlays, setOverlays] = useState<Set<string>>(new Set())
  const [solution, setSolution] = useState(0)
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [ranges, setRanges] = useState<Ranges | null>(null)
  const [showOverlayList, setShowOverlayList] = useState(false)

  useEffect(() => {
    if (!primary) return
    setOverlays(new Set(cards.filter((c) => c.id !== primary.id && overlayable(primary.text, primaryDim) && overlayable(c.text, primaryDim)).map((c) => c.id)))
    setSolution(0)
    setVisible(new Set())
    setRanges(null)
    // re-initialise only when a different card is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryId])

  const others = useMemo(() => cards.filter((c) => c.id !== primaryId && summarizeCard(c.text).plottable && summarizeCard(c.text).dim === primaryDim), [cards, primaryId, primaryDim])

  const analysis = useMemo(() => {
    if (!primary) return null
    const list = [primary, ...cards.filter((c) => overlays.has(c.id))]
    return analyze(list.map((c) => ({ id: c.id, text: c.text })), solution)
  }, [primary, cards, overlays, solution])

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

  const toggleShape = (k: string) =>
    setVisible((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const toggleOverlay = (id: string) =>
    setOverlays((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const showAllShapes = () => {
    if (!analysis) return
    const all = new Set<string>()
    analysis.sections.forEach((s) => s.facts.forEach((f, i) => f.shape && all.add(factKey(s.id, i))))
    setVisible((v) => (v.size === all.size ? new Set() : all))
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-kraft-800/35 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup
          className="kraft-panel fixed inset-0 z-50 flex flex-col overflow-hidden outline-none transition-all data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 sm:inset-3 sm:rounded-2xl lg:inset-6"
          data-no-board
        >
          {analysis && figure && (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b border-kraft-600/20 px-3 py-2.5 sm:px-4">
                <div className="grid size-9 place-items-center rounded-xl bg-kraft-700 text-kraft-50">{analysis.dim === 3 ? <Box className="size-5" /> : <LineChart className="size-5" />}</div>
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="text-[15px] leading-tight font-semibold text-kraft-800">{analysis.dim === 3 ? '空间直角坐标系 · 3D' : '平面直角坐标系 · 2D'}</DialogPrimitive.Title>
                  <p className="truncate text-[11.5px] text-kraft-600">
                    自动选择：{analysis.dimReason} · {analysis.dim === 3 ? '拖动旋转，滚轮 / 双指缩放' : '拖动平移，滚轮 / 双指缩放，缩放后由 Rust 重新采样'}
                  </p>
                </div>
                {others.length > 0 && (
                  <button
                    onClick={() => setShowOverlayList((v) => !v)}
                    className={cn('touch-target hidden h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] sm:flex', showOverlayList ? 'border-kraft-700 bg-kraft-700 text-kraft-50' : 'border-kraft-600/30 bg-kraft-100 text-kraft-800 hover:bg-kraft-50')}
                  >
                    <Layers className="size-4" /> 叠加 {overlays.size}/{others.length}
                  </button>
                )}
                <DialogPrimitive.Close className="touch-target grid size-9 place-items-center rounded-lg text-kraft-700 hover:bg-kraft-200" aria-label="关闭">
                  <X className="size-5" />
                </DialogPrimitive.Close>
              </header>

              {others.length > 0 && (
                <div className={cn('shrink-0 border-b border-kraft-600/15 px-3 py-2 sm:px-4', !showOverlayList && 'sm:hidden')}>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-kraft-600">
                    <Layers className="size-3.5" /> 叠加页面上的其他式子（同一坐标系，自动求交点）
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {others.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggleOverlay(c.id)}
                        className={cn('touch-target flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[13px] transition', overlays.has(c.id) ? 'border-kraft-700 bg-kraft-700 text-kraft-50 [&_.katex]:text-kraft-50' : 'border-kraft-600/25 bg-kraft-100 hover:bg-kraft-50')}
                      >
                        <Tex tex={summarizeCard(c.text).lines[0]?.latex ?? ''} />
                        {summarizeCard(c.text).lines.length > 1 && <span className="text-[10px] opacity-70">+{summarizeCard(c.text).lines.length - 1}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <div className="relative h-[48dvh] shrink-0 border-b border-kraft-600/15 p-1 sm:h-[52dvh] lg:h-auto lg:flex-1 lg:border-r lg:border-b-0">
                  <PlotView data={figure.data} layout={figure.layout} onRange={analysis.dim === 2 ? onRange : undefined} resetKey={objectKey} />
                  {analysis.sections.some((s) => s.facts.some((f) => f.shape)) && (
                    <button onClick={showAllShapes} className="touch-target absolute bottom-3 left-3 flex h-8 items-center gap-1.5 rounded-full border border-kraft-600/30 bg-kraft-100/90 px-3 text-[12px] text-kraft-800 shadow-sm hover:bg-kraft-50">
                      <Sparkles className="size-3.5 text-[#b9852a]" />
                      {visible.size ? '收起推导标注' : '在图上标出全部推导'}
                    </button>
                  )}
                </div>
                <aside className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 sm:px-4 lg:w-[420px] lg:flex-none xl:w-[460px]">
                  <FactsPanel analysis={analysis} visible={visible} onToggleShape={toggleShape} onPickSolution={setSolution} />
                </aside>
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
