import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { startBrowserBridge } from '@/ai/browserBridge'
import { createToolBridge } from '@/ai/tools'
import { AssistSheet } from '@/components/AssistSheet'
import { pushPlotView } from '@/plot/remoteView'
import { Board, type PenSettings } from '@/board/Board'
import { strokeBounds } from '@/board/strokes'
import { uid, type Card, type Doc, type Stroke, type Tool, type View } from '@/board/types'
import { blankDoc, useDocument } from '@/board/useDocument'
import { SettingsSheet, type Prefs } from '@/components/SettingsSheet'
import { Toolbar } from '@/components/Toolbar'
import { TopBar } from '@/components/TopBar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { Composer, insertSnippet } from '@/input/Composer'
import { MathPalette } from '@/input/MathPalette'
import { ShortcutHints } from '@/input/ShortcutHints'
import { pageGroups } from '@/math/page'
import { summarizeCard } from '@/math/scene'
import { parseCard } from '@/math/statements'
import { clusterStrokes, mockRecognizer, OCR_ACCEPT } from '@/ocr/recognizer'
import { PlotButton } from '@/plot/PlotButton'
import { PlotPanel } from '@/plot/PlotPanel'
import { PlotPane } from '@/plot/PlotPane'

const PREFS_KEY = 'mathscrap.prefs.v2'
const DEFAULT_PREFS: Prefs = { penOnly: false, showGrid: false, showHints: true, autoOcr: true }
/** vertical rhythm of formulas written one under another, like lines in a notebook */
const LINE = 60

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

/** Rough ink footprint of a written formula (world units), good enough for layout. */
function footprint(c: Card) {
  const lines = c.text.split('\n')
  return { w: Math.max(90, Math.max(...lines.map((l) => l.length)) * 12.5), h: lines.length * 38 + 8 }
}

function fitView(doc: Doc, compact: boolean, vw = window.innerWidth, vh = window.innerHeight): View {
  const w = vw
  const h = vh
  const items = [
    ...doc.cards.map((c) => {
      const f = footprint(c)
      return [c.x, c.y, c.x + f.w, c.y + f.h]
    }),
    ...doc.stickers.map((s) => [s.x, s.y, s.x + s.text.length * s.size * 0.55, s.y + s.size]),
  ]
  for (const s of doc.strokes) {
    const b = strokeBounds([s])
    items.push([b.x0, b.y0, b.x1, b.y1])
  }
  if (!items.length) return { x: compact ? 24 : Math.round(w * 0.22), y: compact ? 120 : Math.round(h * 0.24), scale: 1 }
  const x0 = Math.min(...items.map((i) => i[0]))
  const y0 = Math.min(...items.map((i) => i[1]))
  const x1 = Math.max(...items.map((i) => i[2]))
  const y1 = Math.max(...items.map((i) => i[3]))
  const padX = compact ? 20 : 120
  const top = compact ? 80 : 90
  const bottom = compact ? 110 : 110
  const scale = Math.max(compact ? 0.6 : 0.35, Math.min(1.25, (w - padX * 2) / (x1 - x0), (h - top - bottom) / (y1 - y0)))
  if (compact) return { scale, x: 20 - x0 * scale, y: top - y0 * scale }
  return { scale, x: (w - (x1 - x0) * scale) / 2 - x0 * scale, y: top + (h - top - bottom - (y1 - y0) * scale) / 2 - y0 * scale }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
}

/** A formula is written only when the sheet can parse it. Error text stays ink. */
function canWriteFormula(text: string): boolean {
  try {
    const sts = parseCard(text)
    return sts.length > 0 && sts.some((s) => s.kind !== 'error')
  } catch {
    return false
  }
}

/** First free writing line at or below (x, y) that doesn't run into ink already on the sheet. */
function freeSpot(x: number, y: number, cards: Card[], h = 40) {
  const hits = (py: number) =>
    cards.some((c) => {
      const f = footprint(c)
      return x < c.x + f.w + 24 && x + 260 > c.x - 24 && py < c.y + f.h + 14 && py + h > c.y - 14
    })
  let py = y
  for (let k = 0; k < 60 && hits(py); k++) py += LINE / 2
  return { x, y: py }
}

interface ComposerState {
  open: boolean
  /** world position the formula will be written at */
  at: { x: number; y: number } | null
  editingId: string | null
}

export default function App() {
  const compact = useMediaQuery('(max-width: 767px)')
  const { doc, docRef, commit, preview, undo, redo, canUndo, canRedo } = useDocument()
  const [view, setView] = useState<View>(() => fitView(doc, window.innerWidth < 768))
  const viewRef = useRef(view)
  viewRef.current = view
  const [tool, setTool] = useState<Tool>('pen')
  const [pen, setPen] = useState<PenSettings>({ color: '#2b2118', width: 3, style: 'ink' })
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [selected, setSelected] = useState<string | null>(null)
  /** `open` shows the corner plot. `details` expands the readouts. `full` is the large dialog. */
  const [plot, setPlot] = useState<{ open: boolean; details: boolean; full: boolean; focusId: string | null }>({ open: false, details: false, full: false, focusId: null })
  const [composerText, setComposerText] = useState('')
  const [composer, setComposer] = useState<ComposerState>({ open: false, at: null, editingId: null })
  const [composerFocused, setComposerFocused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const ocrGen = useRef(0)
  const ocrSettled = useRef(new Set<string>())
  const dragBase = useRef<Doc | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [sheet, setSheet] = useState({ w: window.innerWidth, h: window.innerHeight })

  // the docked pane takes a slice of the window; writing spots and fitting follow the paper
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSheet({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSheet({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const groups = useMemo(() => pageGroups(doc.cards), [doc.cards])
  const plottable = groups.count[2] + groups.count[3]

  const setPrefs = (p: Prefs) => {
    setPrefsState(p)
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  }

  /** Where the next formula goes when you didn't tap a spot: the left third of the view. */
  const writingSpot = useCallback(() => {
    const v = viewRef.current
    const sx = compact ? 24 : Math.max(120, sheet.w * 0.3)
    const sy = compact ? 110 : sheet.h * 0.3
    return freeSpot((sx - v.x) / v.scale, (sy - v.y) / v.scale, docRef.current.cards)
  }, [compact, docRef, sheet])

  const openPlot = useCallback((focusId: string | null = null) => setPlot({ open: true, details: false, full: false, focusId }), [])
  const ensurePlot = useCallback(() => setPlot((p) => (p.open ? p : { open: true, details: false, full: false, focusId: p.focusId })), [])
  const closePlot = useCallback(() => setPlot({ open: false, details: false, full: false, focusId: null }), [])
  const togglePlot = useCallback(() => setPlot((p) => (p.open ? { open: false, details: false, full: false, focusId: null } : { open: true, details: false, full: false, focusId: selected })), [selected])
  const showDetails = useCallback(() => setPlot((p) => ({ ...p, open: true, details: true, full: false })), [])

  const addFormula = useCallback(
    (text: string, x?: number, y?: number) => {
      const spot = x != null && y != null ? { x, y } : writingSpot()
      const card: Card = { id: uid(), text, x: spot.x, y: spot.y }
      commit((d) => ({ ...d, cards: [...d.cards, card] }))
      return card
    },
    [commit, writingSpot],
  )

  const writeBlocks = useCallback(
    (blocks: string[]) => {
      const start = writingSpot()
      const placed: Card[] = []
      let y = start.y
      for (const text of blocks) {
        const spot = freeSpot(start.x, y, [...docRef.current.cards, ...placed])
        const card: Card = { id: uid(), text, x: spot.x, y: spot.y }
        placed.push(card)
        y = spot.y + footprint(card).h + 16
      }
      commit((d) => ({ ...d, cards: [...d.cards, ...placed] }))
      return placed
    },
    [commit, docRef, writingSpot],
  )

  const updateCard = useCallback((id: string, text: string) => commit((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, text } : c)) })), [commit])

  const deleteCard = useCallback(
    (id: string) => {
      commit((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }))
      setSelected(null)
      toast('擦掉了一个式子', { action: { label: '撤销', onClick: undo } })
    },
    [commit, undo],
  )

  const closeComposer = () => {
    setComposerFocused(false)
    setComposerText('')
    setComposer({ open: false, at: null, editingId: null })
  }

  const submitComposer = () => {
    const text = composerText.trim()
    const { editingId, at } = composer
    if (editingId) {
      if (text) updateCard(editingId, text)
      else deleteCard(editingId)
    } else if (text) {
      const c = addFormula(text, at?.x, at?.y)
      setSelected(c.id)
    }
    closeComposer()
    textareaRef.current?.blur()
  }

  const placeComposer = useCallback(
    (x: number, y: number) => {
      setSelected(null)
      setComposerText('')
      setComposer({ open: true, at: { x, y }, editingId: null })
    },
    [],
  )

  const editCard = useCallback(
    (id: string) => {
      const c = docRef.current.cards.find((x) => x.id === id)
      if (!c) return
      setComposerText(c.text)
      setComposer({ open: true, at: { x: c.x, y: c.y }, editingId: id })
    },
    [docRef],
  )

  const zoomBy = (f: number) =>
    setView((v) => {
      const s = Math.min(4, Math.max(0.2, v.scale * f))
      const cx = sheet.w / 2
      const cy = sheet.h / 2
      const k = s / v.scale
      return { scale: s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })

  const commitRecognized = useCallback(
    (text: string, strokes: Stroke[], keep: boolean) => {
      const b = strokeBounds(strokes)
      const ids = new Set(strokes.map((s) => s.id))
      const card: Card = { id: uid(), text: text.trim(), x: b.x0, y: keep ? b.y1 + 14 : b.y0 }
      commit((d) => ({
        ...d,
        strokes: keep ? d.strokes.map((s) => (ids.has(s.id) ? { ...s, recognized: true } : s)) : d.strokes.filter((s) => !ids.has(s.id)),
        cards: [...d.cards, card],
      }))
      if (summarizeCard(card.text).plottable) {
        setPlot((p) => (p.open ? { ...p, focusId: card.id } : { open: true, details: false, full: false, focusId: card.id }))
      }
      return card
    },
    [commit],
  )

  const acceptInk = useCallback(
    (text: string, strokes: Stroke[]) => {
      const ids = new Set(strokes.map((s) => s.id))
      const still = docRef.current.strokes.filter((s) => ids.has(s.id) && !s.recognized)
      if (still.length !== strokes.length || !canWriteFormula(text)) return null
      return commitRecognized(text, still, true)
    },
    [commitRecognized, docRef],
  )

  const recognize = useCallback(() => {
    const pool = docRef.current.strokes.filter((s) => !s.recognized && s.style !== 'marker').slice(-24)
    if (!pool.length) {
      toast('先用笔在纸上写一个式子')
      return
    }
    const clusters = clusterStrokes(pool)
    let pending = clusters.length
    let wrote = 0
    for (const cl of clusters) {
      const key = cl.map((s) => s.id).sort().join(',')
      ocrSettled.current.add(key)
      void mockRecognizer.recognize(cl).then((cands) => {
        const best = cands[0]
        if (best && best.confidence >= OCR_ACCEPT && acceptInk(best.text, cl)) wrote += 1
        pending -= 1
        if (pending === 0 && wrote === 0) toast('没认出来')
      })
    }
  }, [acceptInk, docRef])

  // Settled ink is read on its own. A confident reading is written onto the sheet and the
  // corner plot updates. Nothing is drawn over the paper while that happens.
  useEffect(() => {
    if (!prefs.autoOcr || composer.open) return
    const fresh = doc.strokes.filter((s) => !s.recognized && s.style !== 'marker')
    if (!fresh.length) {
      document.documentElement.dataset.ocr = 'idle'
      return
    }
    document.documentElement.dataset.ocr = 'run'
    const mine = ++ocrGen.current
    const t = setTimeout(() => {
      const jobs: Promise<unknown>[] = []
      for (const cl of clusterStrokes(fresh)) {
        const key = cl.map((s) => s.id).sort().join(',')
        if (ocrSettled.current.has(key)) continue
        jobs.push(
          mockRecognizer.recognize(cl).then((cands) => {
            const ids = new Set(cl.map((s) => s.id))
            const now = docRef.current.strokes.filter((s) => !s.recognized && s.style !== 'marker')
            const group = clusterStrokes(now).find((g) => g.some((s) => ids.has(s.id)))
            const same = !!group && group.length === cl.length && cl.every((s) => group.some((g) => g.id === s.id))
            if (!same) return
            ocrSettled.current.add(key)
            const best = cands[0]
            if (!best || best.confidence < OCR_ACCEPT) return
            acceptInk(best.text, cl)
          }),
        )
      }
      void Promise.all(jobs).finally(() => {
        if (mine === ocrGen.current) document.documentElement.dataset.ocr = 'idle'
      })
    }, 900)
    return () => clearTimeout(t)
  }, [doc.strokes, prefs.autoOcr, composer.open, acceptInk])

  const writeSample = (blocks: string[]) => {
    const placed = writeBlocks(blocks)
    setSelected(null)
    toast.success(blocks.length > 1 ? `写了 ${blocks.length} 个式子，它们会叠在同一个坐标系里` : '写到纸上了', {
      action: { label: '看坐标系', onClick: () => openPlot(placed[0]?.id ?? null) },
    })
  }

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.code === 'KeyZ') {
        if (isTyping(e)) return
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.code === 'KeyY' && !isTyping(e)) {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Escape') {
        if (plot.open && !plot.full && !isTyping(e)) {
          closePlot()
          return
        }
        if (!isTyping(e)) setSelected(null)
        return
      }
      if (isTyping(e) || mod || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        const s = writingSpot()
        placeComposer(s.x, s.y)
      } else if (e.code === 'KeyP') setTool('pen')
      else if (e.code === 'KeyM') setTool('marker')
      else if (e.code === 'KeyE') setTool('eraser')
      else if (e.code === 'KeyV' || e.code === 'KeyH') setTool('select')
      else if (e.code === 'KeyT') setTool('type')
      else if (e.code === 'KeyG') togglePlot()
      else if (e.code === 'KeyR') recognize()
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) deleteCard(selected)
      else if (e.key === 'Enter' && selected) openPlot(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, plot.open, plot.full, recognize, selected, deleteCard, openPlot, closePlot, togglePlot, placeComposer, writingSpot])

  // MCP-ready local tool bridge for experimentation from devtools
  const bridge = useMemo(
    () =>
      createToolBridge({
        getDoc: () => docRef.current,
        addCard: (t, x, y) => addFormula(t, x, y),
        updateCard,
        openPlot: (id) => openPlot(id ?? null),
        setPlotView: (input) => {
          ensurePlot()
          return pushPlotView(input)
        },
      }),
    [docRef, addFormula, updateCard, openPlot, ensurePlot],
  )
  useEffect(() => {
    ;(window as unknown as { mathscrap: { tools: typeof bridge } }).mathscrap = { tools: bridge }
    return startBrowserBridge((name, args) => bridge.call(name, args))
  }, [bridge])

  const anchor = composer.at ? { left: composer.at.x * view.scale + view.x, top: composer.at.y * view.scale + view.y } : null
  const showHints = prefs.showHints && composer.open && composerFocused && (!compact || !composerText)
  const floated = plot.open && !plot.details && !plot.full
  const docked = plot.open && plot.details && !plot.full && !compact
  const modal = plot.open && (plot.full || (plot.details && compact))

  return (
    <div className="fixed inset-0 flex overflow-hidden">
      <div ref={sheetRef} className="relative min-w-0 flex-1 overflow-hidden">
        <Board
          doc={doc}
          view={view}
          setView={setView}
          tool={tool}
          pen={pen}
          penOnly={prefs.penOnly}
          showGrid={prefs.showGrid}
          selectedCard={selected}
          editingCard={composer.editingId}
          onSelectCard={setSelected}
          onPlace={placeComposer}
          onAddStroke={(s) => commit((d) => ({ ...d, strokes: [...d.strokes, s] }))}
          onErase={(ids) => {
            const set = new Set(ids)
            commit((d) => ({ ...d, strokes: d.strokes.filter((s) => !set.has(s.id)) }))
          }}
          onCardDragStart={() => (dragBase.current = docRef.current)}
          onCardDrag={(id, dx, dy) => preview((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, x: c.x + dx, y: c.y + dy } : c)) }))}
          onCardDragEnd={() => {
            if (dragBase.current) commit(docRef.current, dragBase.current)
            dragBase.current = null
          }}
          onPlot={openPlot}
          onEdit={editCard}
          onDelete={deleteCard}
          onPenDetected={() => toast.success('检测到手写笔：笔负责书写，手指负责选择、平移和缩放')}
        >
          <ShortcutHints visible={showHints} compact={compact} placement={anchor && anchor.top < sheet.h / 2 ? 'bottom' : 'top'} />
        </Board>

        <TopBar
          compact={compact}
          scale={view.scale}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onZoom={zoomBy}
          onFit={() => setView(fitView(docRef.current, compact, sheet.w, sheet.h))}
          onClear={() => setConfirmClear(true)}
          onSettings={() => setSettingsOpen(true)}
          onAssist={() => setAssistOpen(true)}
          onSample={writeSample}
        />

        <Toolbar tool={tool} setTool={setTool} pen={pen} setPen={setPen} compact={compact} onRecognize={recognize} />
        <PlotButton count={plottable} compact={compact} open={plot.open && !plot.full} onOpen={togglePlot} />

        {floated && (
          <div
            data-plot-float=""
            data-no-board
            className={cn(
              'absolute z-30 overflow-hidden rounded-2xl opacity-80 shadow-[0_10px_28px_rgba(60,40,20,0.22)]',
              compact ? 'right-3 bottom-[calc(132px+env(safe-area-inset-bottom))] h-[200px] w-[min(300px,78vw)]' : 'right-5 bottom-[4.75rem] h-[240px] w-[360px]',
            )}
          >
            <PlotPane cards={doc.cards} focusId={plot.focusId} variant="float" />
            <button type="button" onClick={showDetails} aria-label="详情" className="paper-chrome absolute top-2 right-2 h-7 rounded-full px-2.5 text-[12px] text-kraft-800">
              详情
            </button>
          </div>
        )}

        <Composer
          value={composerText}
          onChange={setComposerText}
          onSubmit={submitComposer}
          onCancel={closeComposer}
          editing={!!composer.editingId}
          onFocusChange={setComposerFocused}
          textareaRef={textareaRef}
          compact={compact}
          open={composer.open}
          anchor={anchor}
        />

        {!compact && composer.open && composerFocused && (
          <div className="absolute top-1/2 right-4 z-30 -translate-y-1/2 animate-in fade-in slide-in-from-right-2">
            <MathPalette layout="panel" onInsert={(s) => insertSnippet(textareaRef.current, composerText, setComposerText, s)} />
          </div>
        )}
      </div>

      {docked && (
        <aside className="kraft-panel relative z-30 hidden w-[42%] min-w-[400px] max-w-[760px] flex-col border-l border-kraft-800/15 md:flex" data-no-board data-plot-dock="">
          <PlotPane cards={doc.cards} focusId={plot.focusId} variant="dock" onCollapse={() => setPlot((p) => ({ ...p, details: false, full: false }))} onExpand={() => setPlot((p) => ({ ...p, full: true }))} />
        </aside>
      )}

      <PlotPanel cards={doc.cards} open={modal} focusId={plot.focusId} onClose={closePlot} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} prefs={prefs} setPrefs={setPrefs} side={compact ? 'bottom' : 'right'} />
      <AssistSheet
        open={assistOpen}
        onOpenChange={setAssistOpen}
        side={compact ? 'bottom' : 'right'}
        call={(name, args) => bridge.call(name, args)}
        onOpenSettings={() => {
          setAssistOpen(false)
          setSettingsOpen(true)
        }}
      />

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="kraft-panel bg-transparent" data-no-board>
          <DialogHeader>
            <DialogTitle className="text-kraft-800">清空这一页？</DialogTitle>
            <DialogDescription className="text-kraft-600">笔迹和写下的式子都会被擦掉，可以用“撤销”找回。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmClear(false)} className="h-10 rounded-xl px-4 text-[13px] text-kraft-700 hover:bg-kraft-200">
              取消
            </button>
            <button
              onClick={() => {
                commit(blankDoc())
                setConfirmClear(false)
                toast('页面已清空', { action: { label: '撤销', onClick: undo } })
              }}
              className="h-10 rounded-xl bg-ink-red px-4 text-[13px] font-medium text-kraft-50"
            >
              清空
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function EngineGate({ children, error }: { children: React.ReactNode; error: string | null; ready: boolean }) {
  return error ? (
    <div className="kraft-page grid h-full place-items-center p-8 text-center text-kraft-800">
      <div>
        <div className="hand text-[34px] font-bold">数学引擎没能启动</div>
        <p className="mt-2 text-[13px]">Rust/WASM 模块加载失败：{error}</p>
      </div>
    </div>
  ) : (
    <>{children}</>
  )
}

export function Loading() {
  return (
    <div className="kraft-page grid h-full place-items-center text-kraft-800">
      <div className="flex flex-col items-center gap-3">
        <div className="text-[30px] font-semibold tracking-tight">MathScrap</div>
        <div className="flex items-center gap-2 text-[13px] text-kraft-700">
          <Loader2 className="size-4 animate-spin" /> 正在加载 Rust 数学引擎…
        </div>
      </div>
    </div>
  )
}
