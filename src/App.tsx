import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createToolBridge } from '@/ai/tools'
import { Board, type PenSettings } from '@/board/Board'
import { SAMPLES } from '@/board/samples'
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
import { RecognizeDialog } from '@/ocr/RecognizeDialog'
import { PlotButton } from '@/plot/PlotButton'
import { PlotPanel } from '@/plot/PlotPanel'

const PREFS_KEY = 'mathscrap.prefs.v2'
const DEFAULT_PREFS: Prefs = { penOnly: false, showGrid: false, showHints: true }
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

function fitView(doc: Doc, compact: boolean): View {
  const w = window.innerWidth
  const h = window.innerHeight
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
  const [plot, setPlot] = useState<{ open: boolean; focusId: string | null }>({ open: false, focusId: null })
  const [composerText, setComposerText] = useState('')
  const [composer, setComposer] = useState<ComposerState>({ open: false, at: null, editingId: null })
  const [composerFocused, setComposerFocused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [ocrStrokes, setOcrStrokes] = useState<Stroke[] | null>(null)
  const lastRecognize = useRef(0)
  const dragBase = useRef<Doc | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const groups = useMemo(() => pageGroups(doc.cards), [doc.cards])
  const plottable = groups.count[2] + groups.count[3]

  const setPrefs = (p: Prefs) => {
    setPrefsState(p)
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  }

  /** Where the next formula goes when you didn't tap a spot: the left third of the view. */
  const writingSpot = useCallback(() => {
    const v = viewRef.current
    const w = window.innerWidth
    const h = window.innerHeight
    const sx = compact ? 24 : Math.max(120, w * 0.3)
    const sy = compact ? 110 : h * 0.3
    return freeSpot((sx - v.x) / v.scale, (sy - v.y) / v.scale, docRef.current.cards)
  }, [compact, docRef])

  const openPlot = useCallback((focusId: string | null = null) => setPlot({ open: true, focusId }), [])

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
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
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
    setOcrStrokes(pool)
  }, [docRef])

  const confirmRecognize = (text: string, keep: boolean) => {
    if (!ocrStrokes) return
    const b = strokeBounds(ocrStrokes)
    const ids = new Set(ocrStrokes.map((s) => s.id))
    const card: Card = { id: uid(), text: text.trim(), x: b.x0, y: keep ? b.y1 + 14 : b.y0 }
    commit((d) => ({
      ...d,
      strokes: keep ? d.strokes.map((s) => (ids.has(s.id) ? { ...s, recognized: true } : s)) : d.strokes.filter((s) => !ids.has(s.id)),
      cards: [...d.cards, card],
    }))
    lastRecognize.current = Date.now()
    setOcrStrokes(null)
    setSelected(card.id)
  }

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
      if (isTyping(e) || mod || e.altKey || plot.open) return
      if (e.key === '/') {
        e.preventDefault()
        const s = writingSpot()
        placeComposer(s.x, s.y)
      } else if (e.code === 'KeyP') setTool('pen')
      else if (e.code === 'KeyM') setTool('marker')
      else if (e.code === 'KeyE') setTool('eraser')
      else if (e.code === 'KeyV' || e.code === 'KeyH') setTool('select')
      else if (e.code === 'KeyT') setTool('type')
      else if (e.code === 'KeyG') openPlot(selected)
      else if (e.code === 'KeyR') recognize()
      else if (e.key === 'Escape') setSelected(null)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) deleteCard(selected)
      else if (e.key === 'Enter' && selected) openPlot(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, plot.open, recognize, selected, deleteCard, openPlot, placeComposer, writingSpot])

  // MCP-ready local tool bridge for experimentation from devtools
  const bridge = useMemo(
    () => createToolBridge({ getDoc: () => docRef.current, addCard: (t, x, y) => addFormula(t, x, y), updateCard, openPlot: (id) => openPlot(id ?? null) }),
    [docRef, addFormula, updateCard, openPlot],
  )
  useEffect(() => {
    ;(window as unknown as { mathscrap: unknown }).mathscrap = { tools: bridge }
  }, [bridge])

  const anchor = composer.at ? { left: composer.at.x * view.scale + view.x, top: composer.at.y * view.scale + view.y } : null
  const showHints = prefs.showHints && composer.open && composerFocused && (!compact || !composerText)
  const empty = doc.cards.length === 0 && doc.strokes.length === 0

  return (
    <div className="fixed inset-0 overflow-hidden">
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
        <ShortcutHints visible={showHints} compact={compact} placement={anchor && anchor.top < window.innerHeight / 2 ? 'bottom' : 'top'} />
        {empty && !composer.open && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-8 text-center select-none">
            <div className="max-w-md text-kraft-800/60">
              <div className="hand text-[38px] leading-tight font-bold">一张空白的牛皮纸</div>
              <p className="mt-2 text-[14px] leading-relaxed">
                用笔随手画；{compact ? '点 Σ 再点纸面' : '双击纸面或按 /'}，在那里写公式。
                <br />
                写下的所有式子，都会叠进右下角的同一个坐标系。
              </p>
              <button className="pointer-events-auto mt-3 rounded-full px-3 py-1.5 text-[13px] text-kraft-800 underline decoration-kraft-800/30 underline-offset-4 hover:bg-kraft-800/8" onClick={() => writeSample(SAMPLES[0].blocks)} data-no-board>
                先写两个例子试试
              </button>
            </div>
          </div>
        )}
      </Board>

      <TopBar
        compact={compact}
        scale={view.scale}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onZoom={zoomBy}
        onFit={() => setView(fitView(docRef.current, compact))}
        onClear={() => setConfirmClear(true)}
        onSettings={() => setSettingsOpen(true)}
        onSample={writeSample}
      />

      <Toolbar tool={tool} setTool={setTool} pen={pen} setPen={setPen} compact={compact} onRecognize={recognize} />
      <PlotButton count={plottable} compact={compact} onOpen={() => openPlot(selected)} />

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
        <div className="fixed top-1/2 right-4 z-30 -translate-y-1/2 animate-in fade-in slide-in-from-right-2">
          <MathPalette layout="panel" onInsert={(s) => insertSnippet(textareaRef.current, composerText, setComposerText, s)} />
        </div>
      )}

      <PlotPanel cards={doc.cards} open={plot.open} focusId={plot.focusId} onClose={() => setPlot((p) => ({ ...p, open: false }))} />
      <RecognizeDialog strokes={ocrStrokes} onClose={() => setOcrStrokes(null)} onConfirm={confirmRecognize} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} prefs={prefs} setPrefs={setPrefs} side={compact ? 'bottom' : 'right'} />

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
        <div className="hand text-[40px] font-bold">数手账</div>
        <div className="flex items-center gap-2 text-[13px] text-kraft-700">
          <Loader2 className="size-4 animate-spin" /> 正在加载 Rust 数学引擎…
        </div>
      </div>
    </div>
  )
}
