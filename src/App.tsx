import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createToolBridge } from '@/ai/tools'
import { Board, type PenSettings } from '@/board/Board'
import { strokeBounds } from '@/board/strokes'
import { TAPES, uid, type Card, type Doc, type Stroke, type Tool, type View } from '@/board/types'
import { useDocument } from '@/board/useDocument'
import { SettingsSheet, type Prefs } from '@/components/SettingsSheet'
import { Toolbar } from '@/components/Toolbar'
import { TopBar } from '@/components/TopBar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { Composer, insertSnippet } from '@/input/Composer'
import { MathPalette } from '@/input/MathPalette'
import { ShortcutHints } from '@/input/ShortcutHints'
import { RecognizeDialog } from '@/ocr/RecognizeDialog'
import { PlotPanel } from '@/plot/PlotPanel'

const PREFS_KEY = 'mathscrap.prefs.v1'
const CARD_W = 300
const CARD_H = 170

function loadPrefs(): Prefs {
  try {
    return { penOnly: false, showGrid: true, showHints: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { penOnly: false, showGrid: true, showHints: true }
  }
}

function fitView(doc: Doc, compact: boolean): View {
  const w = window.innerWidth
  const h = window.innerHeight
  const items = [...doc.cards.map((c) => [c.x, c.y, c.x + CARD_W, c.y + CARD_H]), ...doc.stickers.map((s) => [s.x, s.y, s.x + s.text.length * s.size * 0.55, s.y + s.size])]
  for (const s of doc.strokes) {
    const b = strokeBounds([s])
    items.push([b.x0, b.y0, b.x1, b.y1])
  }
  if (!items.length) return { x: w / 2 - 200, y: h / 3, scale: 1 }
  const x0 = Math.min(...items.map((i) => i[0]))
  const y0 = Math.min(...items.map((i) => i[1]))
  const x1 = Math.max(...items.map((i) => i[2]))
  const y1 = Math.max(...items.map((i) => i[3]))
  const padX = compact ? 16 : 90
  const top = compact ? 70 : 80
  const bottom = compact ? 90 : 100
  let scale = Math.min(1.1, (w - padX * 2) / (x1 - x0), (h - top - bottom) / (y1 - y0))
  if (compact) {
    // phones: keep cards legible and start at the top-left of the page instead of shrinking everything
    scale = Math.max(scale, Math.min(0.9, (w - 24) / (CARD_W + 30)))
    return { scale, x: 12 - x0 * scale, y: top - y0 * scale }
  }
  scale = Math.max(0.35, scale)
  return { scale, x: (w - (x1 - x0) * scale) / 2 - x0 * scale, y: top + (h - top - bottom - (y1 - y0) * scale) / 2 - y0 * scale }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
}

/** Nearest position to (x, y), scanning outward in rings, where a new card does not cover an existing one. */
function freeSpot(x: number, y: number, cards: Card[]) {
  const pad = 24
  const hits = (px: number, py: number) =>
    cards.some((c) => px < c.x + CARD_W + pad && px + CARD_W + pad > c.x && py < c.y + CARD_H + 60 + pad && py + CARD_H + 60 + pad > c.y)
  if (!hits(x, y)) return { x, y }
  for (let r = 1; r <= 14; r++) {
    const step = 60 * r
    const n = 8 * r
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const px = x + Math.cos(a) * step * 1.4
      const py = y + Math.sin(a) * step
      if (!hits(px, py)) return { x: px, y: py }
    }
  }
  return { x: x + 30, y: y + 30 }
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
  const [plotId, setPlotId] = useState<string | null>(null)
  const [composerText, setComposerText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [ocrStrokes, setOcrStrokes] = useState<Stroke[] | null>(null)
  const [penDetected, setPenDetected] = useState(false)
  const lastRecognize = useRef(0)
  const dragBase = useRef<Doc | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const setPrefs = (p: Prefs) => {
    setPrefsState(p)
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  }

  const visibleCenter = useCallback(() => {
    const v = viewRef.current
    const w = window.innerWidth
    const h = window.innerHeight - (compact ? 240 : 140)
    return { x: (w / 2 - v.x) / v.scale, y: (h / 2 + 40 - v.y) / v.scale }
  }, [compact])

  const addCard = useCallback(
    (text: string, x?: number, y?: number) => {
      const c = visibleCenter()
      const n = docRef.current.cards.length
      const spot = freeSpot(c.x - CARD_W / 2, c.y - CARD_H / 2, docRef.current.cards)
      const card: Card = {
        id: uid(),
        text,
        x: x ?? spot.x,
        y: y ?? spot.y,
        rot: +(Math.random() * 3 - 1.5).toFixed(2),
        tape: TAPES[n % TAPES.length],
      }
      commit((d) => ({ ...d, cards: [...d.cards, card] }))
      return card
    },
    [commit, docRef, visibleCenter],
  )

  const updateCard = useCallback((id: string, text: string) => commit((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, text } : c)) })), [commit])

  const submitComposer = () => {
    const text = composerText.trim()
    if (!text) return
    if (editingId) {
      updateCard(editingId, text)
      toast.success('卡片已更新')
    } else {
      const c = addCard(text)
      setSelected(c.id)
    }
    setComposerText('')
    setEditingId(null)
    if (compact) {
      setComposerOpen(false)
      textareaRef.current?.blur()
    }
  }

  const cancelComposer = () => {
    setComposerText('')
    setEditingId(null)
    setComposerOpen(false)
  }

  const editCard = useCallback(
    (id: string) => {
      const c = docRef.current.cards.find((x) => x.id === id)
      if (!c) return
      setEditingId(id)
      setComposerText(c.text)
      setComposerOpen(true)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [docRef],
  )

  const deleteCard = useCallback(
    (id: string) => {
      commit((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }))
      setSelected(null)
      toast('已删除卡片', { action: { label: '撤销', onClick: undo } })
    },
    [commit, undo],
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
      toast('先用笔在牛皮纸上写一个式子，再点“手写转公式”')
      return
    }
    setOcrStrokes(pool)
  }, [docRef])

  const confirmRecognize = (text: string, keep: boolean) => {
    if (!ocrStrokes) return
    const b = strokeBounds(ocrStrokes)
    const ids = new Set(ocrStrokes.map((s) => s.id))
    const n = docRef.current.cards.length
    const card: Card = { id: uid(), text: text.trim(), x: b.x0, y: b.y1 + 18, rot: 0.6, tape: TAPES[n % TAPES.length] }
    commit((d) => ({
      ...d,
      strokes: keep ? d.strokes.map((s) => (ids.has(s.id) ? { ...s, recognized: true } : s)) : d.strokes.filter((s) => !ids.has(s.id)),
      cards: [...d.cards, card],
    }))
    lastRecognize.current = Date.now()
    setOcrStrokes(null)
    setSelected(card.id)
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
      if (isTyping(e) || mod || e.altKey || plotId) return
      if (e.key === '/') {
        e.preventDefault()
        setComposerOpen(true)
        textareaRef.current?.focus()
      } else if (e.code === 'KeyP') setTool('pen')
      else if (e.code === 'KeyM') setTool('marker')
      else if (e.code === 'KeyE') setTool('eraser')
      else if (e.code === 'KeyH') setTool('hand')
      else if (e.code === 'KeyR') recognize()
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) deleteCard(selected)
      else if (e.key === 'Enter' && selected) setPlotId(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, plotId, recognize, selected, deleteCard])

  // MCP-ready local tool bridge for experimentation from devtools
  const bridge = useMemo(() => createToolBridge({ getDoc: () => docRef.current, addCard: (t, x, y) => addCard(t, x, y), updateCard, openPlot: setPlotId }), [docRef, addCard, updateCard])
  useEffect(() => {
    ;(window as unknown as { mathscrap: unknown }).mathscrap = { tools: bridge }
  }, [bridge])

  const showHints = prefs.showHints && composerFocused

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
        onSelectCard={setSelected}
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
        onPlot={setPlotId}
        onEdit={editCard}
        onDelete={deleteCard}
        onPenDetected={() => {
          setPenDetected(true)
          toast.success('检测到手写笔：笔负责书写，手指负责平移和缩放')
        }}
      >
        <ShortcutHints visible={showHints} compact={compact} />
        {doc.cards.length === 0 && doc.strokes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-8 text-center">
            <div className="max-w-md text-kraft-800/70">
              <div className="hand text-[40px] leading-tight font-bold">一张空白的牛皮纸</div>
              <p className="mt-2 text-[14px]">用笔随手写画，或在下方输入框写公式（{compact ? '点“公式”' : '按 /'}）。也可以从“示例”里挑一个开始。</p>
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
        onSample={(t) => {
          const c = addCard(t)
          setSelected(c.id)
          toast.success('示例已贴到页面，点卡片右下角的图表按钮看推导')
        }}
        penDetected={penDetected}
      />

      <Toolbar tool={tool} setTool={setTool} pen={pen} setPen={setPen} compact={compact} onRecognize={recognize} onOpenComposer={() => setComposerOpen(true)} />

      <Composer
        value={composerText}
        onChange={setComposerText}
        onSubmit={submitComposer}
        onCancel={cancelComposer}
        editing={!!editingId}
        focused={composerFocused}
        onFocusChange={setComposerFocused}
        textareaRef={textareaRef}
        compact={compact}
        open={composerOpen}
      />

      {!compact && composerFocused && (
        <div className="fixed right-3 bottom-4 z-30 animate-in fade-in slide-in-from-right-2">
          <MathPalette layout="panel" onInsert={(s) => insertSnippet(textareaRef.current, composerText, setComposerText, s)} />
        </div>
      )}

      <PlotPanel cards={doc.cards} primaryId={plotId} onClose={() => setPlotId(null)} />
      <RecognizeDialog strokes={ocrStrokes} onClose={() => setOcrStrokes(null)} onConfirm={confirmRecognize} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} prefs={prefs} setPrefs={setPrefs} side={compact ? 'bottom' : 'right'} />

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="kraft-panel bg-transparent" data-no-board>
          <DialogHeader>
            <DialogTitle className="text-kraft-800">清空这一页？</DialogTitle>
            <DialogDescription className="text-kraft-600">所有笔迹和公式卡片都会被移除，可以用“撤销”找回。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmClear(false)} className="h-10 rounded-xl px-4 text-[13px] text-kraft-700 hover:bg-kraft-200">
              取消
            </button>
            <button
              onClick={() => {
                commit({ strokes: [], cards: [], stickers: [] })
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
