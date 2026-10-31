import { Loader2 } from 'lucide-react'
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
import { InkChip, type InkChipData } from '@/ocr/InkChip'
import { clusterStrokes, mockRecognizer } from '@/ocr/recognizer'
import { RecognizeDialog } from '@/ocr/RecognizeDialog'
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
  /** `open` shows the shared coordinate system: docked beside the sheet, or full-screen (`full`) */
  const [plot, setPlot] = useState<{ open: boolean; full: boolean; focusId: string | null }>({ open: false, full: false, focusId: null })
  const [composerText, setComposerText] = useState('')
  const [composer, setComposer] = useState<ComposerState>({ open: false, at: null, editingId: null })
  const [composerFocused, setComposerFocused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [ocrStrokes, setOcrStrokes] = useState<Stroke[] | null>(null)
  const [inkChips, setInkChips] = useState<InkChipData[]>([])
  const chipHandled = useRef<Set<string>>(new Set())
  const lastRecognize = useRef(0)
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

  const openPlot = useCallback((focusId: string | null = null) => setPlot({ open: true, full: false, focusId }), [])
  const ensurePlot = useCallback(() => setPlot((p) => (p.open ? p : { ...p, open: true, full: false })), [])
  const closePlot = useCallback(() => setPlot((p) => ({ ...p, open: false, full: false })), [])
  const togglePlot = useCallback(() => setPlot((p) => (p.open ? { ...p, open: false, full: false } : { open: true, full: false, focusId: selected })), [selected])

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

  const recognize = useCallback(() => {
    const fresh = docRef.current.strokes.filter((s) => !s.recognized && s.createdAt > lastRecognize.current && s.style !== 'marker')
    const pool = fresh.length ? fresh : docRef.current.strokes.filter((s) => !s.recognized && s.style !== 'marker').slice(-20)
    if (!pool.length) {
      toast('先用笔在纸上写一个式子，再点“手写转公式”')
      return
    }
    setInkChips([])
    setOcrStrokes(pool)
  }, [docRef])

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
      lastRecognize.current = Date.now()
      chipHandled.current = new Set([...chipHandled.current, ...ids])
      setInkChips((cs) => cs.filter((c) => !c.strokes.some((s) => ids.has(s.id))))
      setSelected(card.id)
      return card
    },
    [commit],
  )

  const confirmRecognize = (text: string, keep: boolean) => {
    if (!ocrStrokes) return
    const card = commitRecognized(text, ocrStrokes, keep)
    setOcrStrokes(null)
    toast.success('手写已写成公式', { action: { label: '看坐标系', onClick: () => openPlot(card.id) } })
  }

  // ---- handwriting → formula, automatically -------------------------------------------------
  // While auto-OCR is on (default), settled ink raises a small candidate chip on the paper.
  // Accepting writes the formula — and the docked plot emerges it statement by statement.
  useEffect(() => {
    if (!prefs.autoOcr || composer.open || ocrStrokes) {
      return
    }
    const fresh = doc.strokes.filter((s) => !s.recognized && s.style !== 'marker' && !chipHandled.current.has(s.id))
    setInkChips((chips) => chips.filter((c) => c.strokes.every((s) => fresh.some((f) => f.id === s.id))))
    if (fresh.length < 1) return
    const t = setTimeout(() => {
      const clusters = clusterStrokes(fresh)
      setInkChips((chips) => {
        const kept = chips.filter((c) => {
          const ids = c.strokes.map((s) => s.id)
          const cl = clusters.find((x) => x.some((s) => s.id === ids[0]))
          return !!cl && cl.length === ids.length && cl.every((s) => ids.includes(s.id))
        })
        const used = new Set(kept.flatMap((c) => c.strokes.map((s) => s.id)))
        const add = clusters
          .filter((cl) => !cl.some((s) => used.has(s.id)))
          .map<InkChipData>((cl) => {
            const b = strokeBounds(cl)
            const chip: InkChipData = { id: uid(), strokes: cl, at: { x: (b.x0 + b.x1) / 2, y: b.y1 + 12 }, cands: null, pick: 0 }
            mockRecognizer.recognize(cl).then((cands) => setInkChips((cs) => cs.map((x) => (x.id === chip.id ? { ...x, cands } : x))))
            return chip
          })
        return kept.length + add.length ? [...kept, ...add] : []
      })
    }, 900)
    return () => clearTimeout(t)
  }, [doc.strokes, prefs.autoOcr, composer.open, ocrStrokes])

  const acceptChip = useCallback(
    (chip: InkChipData) => {
      const cand = chip.cands?.[chip.pick]
      if (!cand) return
      const card = commitRecognized(cand.text, chip.strokes, true)
      toast.success(`识别为公式并写到纸上（${Math.round(cand.confidence * 100)}%）`, { action: { label: '看坐标系', onClick: () => openPlot(card.id) } })
    },
    [commitRecognized, openPlot],
  )

  const dismissChip = useCallback((chip: InkChipData) => {
    chipHandled.current = new Set([...chipHandled.current, ...chip.strokes.map((s) => s.id)])
    setInkChips((cs) => cs.filter((c) => c.id !== chip.id))
  }, [])

  const cycleChip = useCallback((chip: InkChipData) => {
    setInkChips((cs) => cs.map((c) => (c.id === chip.id && c.cands?.length ? { ...c, pick: (c.pick + 1) % c.cands.length } : c)))
  }, [])

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
  const docked = plot.open && !plot.full && !compact
  const modal = plot.open && (plot.full || compact)

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

        {inkChips.map((chip) => (
          <InkChip key={chip.id} chip={chip} view={view} onAccept={() => acceptChip(chip)} onDismiss={() => dismissChip(chip)} onCycle={() => cycleChip(chip)} />
        ))}

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
        <PlotButton count={plottable} compact={compact} open={docked} onOpen={compact ? () => openPlot(selected) : togglePlot} />

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
          <PlotPane cards={doc.cards} focusId={plot.focusId} variant="dock" onExpand={() => setPlot((p) => ({ ...p, full: true }))} />
        </aside>
      )}

      <PlotPanel cards={doc.cards} open={modal} focusId={plot.focusId} onClose={closePlot} />
      <RecognizeDialog strokes={ocrStrokes} onClose={() => setOcrStrokes(null)} onConfirm={confirmRecognize} />
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
