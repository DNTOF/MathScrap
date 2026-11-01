import { Eye, EyeOff, Focus, Maximize2, Scan, Sparkles, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import type { Card } from '@/board/types'
import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { pageGroups } from '@/math/page'
import { analyze } from '@/math/scene'
import type { RustShape } from '@/wasm/engine'
import { FactsPanel, factKey } from './FactsPanel'
import { buildFigure2d, buildFigure3d, initialRanges, type Ranges } from './figure'
import { subscribePlotView, takePlotView, type Camera3, type PlotViewCommand } from './remoteView'
import { PlotView } from './PlotView'

interface Props {
  cards: Card[]
  /** formula the pane was opened from — decides plane vs space when the sheet has both */
  focusId: string | null
  /** `float` is the corner picture only. `dock` and `modal` include the readouts. */
  variant: 'float' | 'dock' | 'modal'
  onExpand?: () => void
  onCollapse?: () => void
}

const staticMode = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('static')

/**
 * The sheet's one shared coordinate system: every formula on the paper is drawn on the same
 * axes and analysed together (intersections, unknowns, geometry). Lives inside the docked
 * side-by-side pane and inside the full-screen dialog.
 *
 * Live behaviour: the analysis input goes through `useDeferredValue` so heavy Rust runs never
 * block writing, the user's zoom survives every sheet edit (an explicit button refits), and
 * freshly added statements emerge one by one instead of appearing as one batch.
 */
export function PlotPane({ cards, focusId, variant, onExpand, onCollapse }: Props) {
  const groups = useMemo(() => pageGroups(cards), [cards])
  const [mode, setMode] = useState<2 | 3>(2)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [solution, setSolution] = useState(0)
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [ranges, setRanges] = useState<Ranges | null>(null)
  const [camera, setCamera] = useState<Camera3 | undefined>(undefined)
  const [zRange, setZRange] = useState<[number, number] | undefined>(undefined)
  const [rev, setRev] = useState(0)
  const holdRange = useRef(false)

  const focusEntry = useMemo(() => groups.entries.find((e) => e.card.id === focusId), [groups, focusId])
  // plane vs space on (re)open, and follow the focused formula across the sheet
  useEffect(() => {
    setMode(focusEntry ? focusEntry.dim : groups.count[2] || !groups.count[3] ? 2 : 3)
    setHidden((h) => new Set([...h].filter((id) => cards.some((c) => c.id === id))))
    setSolution(0)
    setVisible(new Set())
    setRanges(null)
    setCamera(undefined)
    setZRange(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntry?.card.id])

  const entries = useMemo(() => groups.entries.filter((e) => e.dim === mode), [groups, mode])
  const active = useMemo(() => entries.filter((e) => !hidden.has(e.card.id)), [entries, hidden])
  const activeInput = useMemo(() => active.map((e) => ({ id: e.card.id, text: e.card.text })), [active])
  // heavy inference runs on a deferred copy: writing on the sheet never blocks
  const deferredInput = useDeferredValue(activeInput)
  const stale = deferredInput !== activeInput

  const analysis = useMemo(() => (deferredInput.length ? analyze(deferredInput, solution) : null), [deferredInput, solution])

  const shapes = useMemo(() => {
    if (!analysis) return [] as RustShape[]
    const out: RustShape[] = []
    analysis.sections.forEach((s) => s.facts.forEach((f, i) => f.shape && visible.has(factKey(s.id, i)) && out.push(f.shape)))
    return out
  }, [analysis, visible])

  // ---- progressive figure: statements emerge one by one ---------------------------------------
  // Derived during render (StrictMode-safe): a growing object count animates from the previous
  // count, the steps wait for the first actual draw so the growth is visible, and shrinking /
  // reduced-motion / ?static=1 jump straight to the full figure.
  const objCount = analysis?.objects.length ?? 0
  const [revealState, setRevealState] = useState({ count: 0, revealed: 0 })
  const [plotReady, setPlotReady] = useState(false)
  if (objCount !== revealState.count) {
    const animate = !staticMode() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const revealed = animate ? Math.min(revealState.revealed, objCount) : objCount
    setRevealState({ count: objCount, revealed })
  }
  const revealed = analysis ? revealState.revealed : 0
  useEffect(() => {
    if (objCount === 0 || revealed >= objCount) return
    if (!plotReady && !staticMode()) return
    const t = setInterval(() => setRevealState((s) => ({ ...s, revealed: Math.min(s.revealed + 1, objCount) })), revealed === 0 ? 240 : 200)
    return () => clearInterval(t)
  }, [revealed, objCount, plotReady])

  const shownAnalysis = useMemo(
    () => (analysis && revealed < analysis.objects.length ? { ...analysis, objects: analysis.objects.slice(0, revealed) } : analysis),
    [analysis, revealed],
  )

  const viewKey = `${mode}`
  const revision = rev === 0 ? 'keep' : `v${rev}`
  const base = useMemo(() => (analysis && analysis.dim === 2 ? initialRanges(analysis) : null), [analysis])
  const figure = useMemo(() => {
    if (!shownAnalysis) return null
    if (shownAnalysis.dim === 3) return buildFigure3d(shownAnalysis, shapes, { camera, z: zRange, revision })
    return buildFigure2d(shownAnalysis, ranges ?? base!, shapes, revision)
  }, [shownAnalysis, shapes, ranges, base, camera, zRange, revision])

  // the user's zoom survives sheet edits; only switching plane/space refits
  useEffect(() => {
    if (holdRange.current) {
      holdRange.current = false
      return
    }
    setRanges(null)
  }, [viewKey])

  useEffect(() => {
    const apply = (req: PlotViewCommand) => {
      if ((req.mode === 2 || req.mode === 3) && req.mode !== mode) {
        holdRange.current = true
        setMode(req.mode)
      }
      if (req.fit) {
        setRanges(null)
        setCamera(undefined)
        setZRange(undefined)
        setRev((n) => n + 1)
      } else {
        if (req.x && req.y) setRanges({ x: req.x, y: req.y })
        if (req.camera) setCamera(req.camera)
        if (req.z) setZRange(req.z)
        if (req.x || req.camera || req.z) setRev((n) => n + 1)
      }
      if (req.only || req.show || req.hide) {
        setHidden((prev) => {
          const next = req.only ? new Set(groups.entries.map((e) => e.card.id).filter((id) => !req.only!.includes(id))) : new Set(prev)
          for (const id of req.show ?? []) next.delete(id)
          for (const id of req.hide ?? []) next.add(id)
          return next
        })
      }
    }
    const missed = takePlotView()
    if (missed) apply(missed)
    return subscribePlotView(apply)
  }, [mode, groups.entries])

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
  const dock = variant === 'dock'

  if (variant === 'float') {
    return (
      <div className="h-full w-full" data-plot-pane="float" data-plot-mode={mode}>
        {analysis && figure ? (
          <PlotView
            data={figure.data.map((trace) => ({ ...trace, showlegend: false }))}
            layout={{ ...figure.layout, showlegend: false }}
            bare
            onRange={analysis.dim === 2 ? onRange : undefined}
            resetKey={viewKey}
            onReady={() => setPlotReady(true)}
          />
        ) : (
          <div className="h-full w-full" />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-plot-pane={variant} data-plot-mode={mode}>
      <header className={cn('flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1', dock ? 'px-3 pt-2.5 pb-1.5' : 'px-4 pt-3 pb-2')}>
        <div className="min-w-0 flex-1">
          {dock ? (
            <h2 className="hand truncate text-[19px] leading-none font-bold text-kraft-800">{mode === 3 ? '空间直角坐标系' : '平面直角坐标系'}</h2>
          ) : (
            <DialogPrimitive.Title className="hand text-[26px] leading-none font-bold text-kraft-800">{mode === 3 ? '空间直角坐标系' : '平面直角坐标系'}</DialogPrimitive.Title>
          )}
          <p className={cn('mt-1 truncate text-[12px] text-kraft-700', stale && 'opacity-60')}>
            纸上 {drawn} 个式子{conditions ? ` + ${conditions} 个条件` : ''}画在同一坐标系里{stale ? ' · 正在重算…' : ''}
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
        <button
          onClick={() => {
            setRanges(null)
            setCamera(undefined)
            setZRange(undefined)
            setRev((n) => n + 1)
          }}
          aria-label="适应视野"
          title="回到恰好框住所有图形的初始视野"
          className="touch-target grid size-9 place-items-center rounded-full text-kraft-700 hover:bg-kraft-800/10"
        >
          <Focus className="size-4.5" />
        </button>
        {dock ? (
          <>
            {onCollapse && (
              <button onClick={onCollapse} aria-label="只看图" title="回到右下角的图" className="h-8 rounded-full px-2.5 text-[12.5px] text-kraft-700 hover:bg-kraft-800/10">
                只看图
              </button>
            )}
            {onExpand && (
              <button onClick={onExpand} aria-label="全屏坐标系" title="放大到全屏" className="touch-target grid size-9 place-items-center rounded-full text-kraft-700 hover:bg-kraft-800/10">
                <Maximize2 className="size-4.5" />
              </button>
            )}
          </>
        ) : (
          <DialogPrimitive.Close className="touch-target grid size-9 place-items-center rounded-full text-kraft-700 hover:bg-kraft-800/10" aria-label="关闭">
            <X className="size-5" />
          </DialogPrimitive.Close>
        )}
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
        <div className={cn('flex min-h-0 flex-1 flex-col border-t border-kraft-800/10', !dock && 'lg:flex-row')}>
          <div className={cn('relative min-h-0 shrink-0 border-b border-kraft-800/10 p-1', dock ? 'h-[52%]' : 'h-[48dvh] sm:h-[52dvh] lg:h-auto lg:flex-1 lg:border-r lg:border-b-0')}>
            <PlotView data={figure.data} layout={figure.layout} onRange={analysis.dim === 2 ? onRange : undefined} resetKey={viewKey} onReady={() => setPlotReady(true)} />
            {analysis.sections.some((s) => s.facts.some((f) => f.shape)) && (
              <button onClick={showAllShapes} className="paper-chrome touch-target absolute bottom-3 left-3 flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-kraft-800">
                <Sparkles className="size-3.5 text-[#b9852a]" />
                {visible.size ? '收起推导标注' : '在图上标出全部推导'}
              </button>
            )}
          </div>
          <aside className={cn('min-h-0 overflow-y-auto px-4 pt-3', dock ? 'flex-1' : 'flex-1 lg:w-[420px] lg:flex-none xl:w-[460px]')}>
            <FactsPanel analysis={analysis} visible={visible} onToggleShape={(k) => toggle(setVisible, k)} onPickSolution={setSolution} />
          </aside>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center border-t border-kraft-800/10 p-8 text-center text-kraft-800/75">
          <div>
            <div className="hand flex items-center justify-center gap-2 text-[26px] font-bold">
              <Scan className="size-5 opacity-50" />
              {entries.length ? '式子都先拿掉了' : '纸上还没有能画的式子'}
            </div>
            <p className="mt-1 text-[13px]">{entries.length ? '点上面的式子把它放回坐标系。' : dock ? '在左边纸上写一个式子，这里马上画出来。' : '在纸上写一个函数、方程或几何条件，再回来看。'}</p>
          </div>
        </div>
      )}
    </div>
  )
}
