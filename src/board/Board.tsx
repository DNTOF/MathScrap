import { useCallback, useEffect, useRef, useState } from 'react'
import { InkFormula } from './InkFormula'
import { hitStroke, StrokeDefs, StrokeShape } from './strokes'
import { uid, type Doc, type PenStyle, type Stroke, type Tool, type View } from './types'

export interface PenSettings {
  color: string
  width: number
  style: PenStyle
}

interface Props {
  doc: Doc
  view: View
  setView: (v: View | ((v: View) => View)) => void
  tool: Tool
  pen: PenSettings
  penOnly: boolean
  showGrid: boolean
  selectedCard: string | null
  /** formula currently open in the composer — hidden on the sheet while it is being rewritten */
  editingCard: string | null
  onSelectCard: (id: string | null) => void
  /** tap with the type tool, or double-click anywhere on empty paper */
  onPlace: (x: number, y: number) => void
  onAddStroke: (s: Stroke) => void
  onErase: (ids: string[]) => void
  onCardDragStart: (id: string) => void
  onCardDrag: (id: string, dx: number, dy: number) => void
  onCardDragEnd: (id: string) => void
  onPlot: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onPenDetected: () => void
  children?: React.ReactNode
}

type Mode = { kind: 'draw' } | { kind: 'erase' } | { kind: 'pan'; x: number; y: number; x0: number; y0: number; place: boolean } | { kind: 'pinch' }

export function Board(props: Props) {
  const { doc, view, setView, tool, pen, penOnly, showGrid } = props
  const ref = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>())
  const mode = useRef<Mode | null>(null)
  const pinch = useRef<{ d: number; cx: number; cy: number; view: View } | null>(null)
  const [live, setLive] = useState<Stroke | null>(null)
  const liveRef = useRef<Stroke | null>(null)
  const [erasing, setErasing] = useState<Set<string>>(new Set())
  const erasingRef = useRef<Set<string>>(new Set())
  const [space, setSpace] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const penSeen = useRef(false)

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (cx - r.left - v.x) / v.scale, y: (cy - r.top - v.y) / v.scale }
  }, [])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        setSpace(true)
        e.preventDefault()
      }
    }
    const ku = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  // wheel: pan, ctrl/⌘ + wheel (and trackpad pinch) zooms around the cursor
  useEffect(() => {
    const el = ref.current!
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-no-board]')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.0105)
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        setView((v) => {
          const s = Math.min(4, Math.max(0.2, v.scale * f))
          const k = s / v.scale
          return { scale: s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
        })
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setView])

  // a lone dot waits a moment before it is inked, so the two clicks of a double-click leave no marks
  const pendingDots = useRef<{ s: Stroke; t: ReturnType<typeof setTimeout> }[]>([])
  const [dots, setDots] = useState<Stroke[]>([])
  const finishStroke = () => {
    const s = liveRef.current
    liveRef.current = null
    setLive(null)
    if (!s || s.pts.length < 3) return
    if (s.pts.length > 3) return props.onAddStroke(s)
    const t = setTimeout(() => {
      pendingDots.current = pendingDots.current.filter((d) => d.s !== s)
      setDots(pendingDots.current.map((d) => d.s))
      props.onAddStroke(s)
    }, 320)
    pendingDots.current.push({ s, t })
    setDots(pendingDots.current.map((d) => d.s))
  }
  const dropDots = () => {
    pendingDots.current.forEach((d) => clearTimeout(d.t))
    pendingDots.current = []
    setDots([])
  }

  const finishErase = () => {
    const ids = [...erasingRef.current]
    erasingRef.current = new Set()
    setErasing(new Set())
    if (ids.length) props.onErase(ids)
  }

  const eraseAt = (cx: number, cy: number) => {
    const w = toWorld(cx, cy)
    const r = 12 / viewRef.current.scale
    let changed = false
    for (const s of doc.strokes) {
      if (!erasingRef.current.has(s.id) && hitStroke(s, w.x, w.y, r)) {
        erasingRef.current.add(s.id)
        changed = true
      }
    }
    if (changed) setErasing(new Set(erasingRef.current))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen' && !penSeen.current) {
      penSeen.current = true
      props.onPenDetected()
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    props.onSelectCard(null)

    const touches = [...pointers.current.values()].filter((p) => p.type === 'touch')
    if (touches.length >= 2) {
      // second finger: abandon the stroke and start pinch-zooming
      liveRef.current = null
      setLive(null)
      const [a, b] = touches
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: viewRef.current }
      mode.current = { kind: 'pinch' }
      return
    }
    const palm = e.pointerType === 'touch' && (penOnly || penSeen.current)
    if (e.button === 1 || space || tool === 'select' || tool === 'type' || palm) {
      const place = tool === 'type' && e.button === 0 && !space && !palm
      mode.current = { kind: 'pan', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, place }
      return
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (tool === 'eraser') {
      mode.current = { kind: 'erase' }
      eraseAt(e.clientX, e.clientY)
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    const s: Stroke = {
      id: uid(),
      pts: [w.x, w.y, e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5],
      color: pen.color,
      width: tool === 'marker' ? pen.width * 1.4 : pen.width,
      style: tool === 'marker' ? 'marker' : pen.style,
      createdAt: Date.now(),
    }
    liveRef.current = s
    setLive(s)
    mode.current = { kind: 'draw' }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    const m = mode.current
    if (!m) return
    if (m.kind === 'pinch' && pinch.current) {
      const touches = [...pointers.current.values()].filter((p) => p.type === 'touch')
      if (touches.length < 2) return
      const [a, b] = touches
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const p0 = pinch.current
      const r = ref.current!.getBoundingClientRect()
      const s = Math.min(4, Math.max(0.2, p0.view.scale * (d / p0.d)))
      const k = s / p0.view.scale
      const ox = p0.cx - r.left
      const oy = p0.cy - r.top
      setView({ scale: s, x: ox - (ox - p0.view.x) * k + (cx - p0.cx), y: oy - (oy - p0.view.y) * k + (cy - p0.cy) })
      return
    }
    if (m.kind === 'pan') {
      const dx = e.clientX - m.x
      const dy = e.clientY - m.y
      m.x = e.clientX
      m.y = e.clientY
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
      return
    }
    if (m.kind === 'erase') {
      eraseAt(e.clientX, e.clientY)
      return
    }
    if (m.kind === 'draw' && liveRef.current) {
      const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      const list = evs.length ? evs : [e.nativeEvent]
      const pts = liveRef.current.pts.slice()
      for (const ev of list) {
        const w = toWorld(ev.clientX, ev.clientY)
        const lx = pts[pts.length - 3]
        const ly = pts[pts.length - 2]
        if (Math.hypot(w.x - lx, w.y - ly) * viewRef.current.scale < 0.8) continue
        pts.push(w.x, w.y, ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5)
      }
      liveRef.current = { ...liveRef.current, pts }
      setLive(liveRef.current)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const m = mode.current
    if (m?.kind === 'pinch') {
      if ([...pointers.current.values()].filter((p) => p.type === 'touch').length < 2) {
        pinch.current = null
        mode.current = null
      }
      return
    }
    if (m?.kind === 'pan' && m.place && Math.hypot(e.clientX - m.x0, e.clientY - m.y0) < 6) {
      const w = toWorld(e.clientX, e.clientY)
      props.onPlace(w.x, w.y)
    }
    if (m?.kind === 'draw') finishStroke()
    if (m?.kind === 'erase') finishErase()
    mode.current = null
  }

  const drawing = tool === 'pen' || tool === 'marker' || tool === 'eraser'
  const fingerSelects = penOnly || penSeen.current
  const passThrough = useCallback(
    (e: React.PointerEvent) => (drawing || space) && !(e.pointerType === 'touch' && fingerSelects),
    [drawing, space, fingerSelects],
  )
  const cursor = space || tool === 'select' ? 'grab' : tool === 'type' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair'

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-board]')) return
    dropDots()
    // pointer capture makes the board the click target even when the pointer is over a formula
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-formula]')
    if (hit) {
      props.onEdit(hit.dataset.formula!)
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    props.onPlace(w.x, w.y)
  }
  const grid = 28 * view.scale

  return (
    <div
      ref={ref}
      className="kraft-page absolute inset-0 overflow-hidden"
      style={{ touchAction: 'none', cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {showGrid && <div className="dot-grid pointer-events-none absolute inset-0" style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }} />}
      {props.children}
      <div className="absolute top-0 left-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
        {doc.stickers.map((s) => (
          <div key={s.id} className="hand pointer-events-none absolute whitespace-nowrap text-kraft-800/85 select-none" style={{ left: s.x, top: s.y, fontSize: s.size, transform: `rotate(${s.rot}deg)`, fontWeight: 700 }}>
            {s.text}
          </div>
        ))}
        {doc.cards.map((c) => (
          <InkFormula
            key={c.id}
            card={c}
            scale={view.scale}
            inkFirst={passThrough}
            movable={!drawing && !space}
            selected={props.selectedCard === c.id}
            hidden={props.editingCard === c.id}
            onSelect={props.onSelectCard}
            onDragStart={props.onCardDragStart}
            onDrag={props.onCardDrag}
            onDragEnd={props.onCardDragEnd}
            onPlot={props.onPlot}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        ))}
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
          <StrokeDefs />
          {doc.strokes.map((s) => (
            <g key={s.id} opacity={erasing.has(s.id) ? 0.15 : 1}>
              <StrokeShape s={s} />
            </g>
          ))}
          {dots.map((s) => (
            <StrokeShape key={s.id} s={s} />
          ))}
          {live && <StrokeShape s={live} />}
        </svg>
      </div>
    </div>
  )
}
