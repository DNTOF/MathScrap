import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { InkFormula } from './InkFormula'
import { hitStroke, hitStrokeCapsule } from './strokeGeom'
import { StrokeDefs, StrokeShape } from './strokes'
import { uid, type Doc, type PenStyle, type Stroke, type Tool, type View } from './types'
import { clientToWorld, eraserWorldRadius } from './viewGeom'

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
  onCardDragCancel: (id: string) => void
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
  useLayoutEffect(() => {
    viewRef.current = view
  }, [view])
  const penSeen = useRef(false)
  const active = useRef<number | null>(null)
  const lastErase = useRef<{ x: number; y: number } | null>(null)

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect()
    return clientToWorld(cx, cy, r, viewRef.current)
  }, [])

  const abortLive = useCallback(() => {
    const busy = mode.current !== null || liveRef.current !== null || erasingRef.current.size > 0 || active.current !== null
    liveRef.current = null
    erasingRef.current = new Set()
    lastErase.current = null
    pinch.current = null
    mode.current = null
    active.current = null
    pointers.current.clear()
    if (!busy) return
    setLive(null)
    setErasing(new Set())
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

  // A gesture that is cancelled, loses capture, or is interrupted must not become ink.
  // Layout, not a passive effect: the tool button updates before this returns, and pointerup must already see an empty gesture.
  useLayoutEffect(() => {
    const kind = mode.current?.kind
    if (kind === 'draw' || kind === 'erase') abortLive()
  }, [tool, abortLive])
  useEffect(() => {
    const onBlur = () => abortLive()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [abortLive])

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
    lastErase.current = null
    if (ids.length) props.onErase(ids)
  }

  const eraseAt = (cx: number, cy: number) => {
    const w = toWorld(cx, cy)
    const r = eraserWorldRadius(viewRef.current.scale)
    const prev = lastErase.current
    lastErase.current = w
    let changed = false
    for (const s of doc.strokes) {
      if (erasingRef.current.has(s.id)) continue
      const hit = prev ? hitStrokeCapsule(s, prev.x, prev.y, w.x, w.y, r) : hitStroke(s, w.x, w.y, r)
      if (hit) {
        erasingRef.current.add(s.id)
        changed = true
      }
    }
    if (changed) setErasing(() => new Set(erasingRef.current))
  }

  const capture = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events and a pointer the browser already took */
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-board]')) return
    if (e.pointerType === 'pen' && !penSeen.current) {
      penSeen.current = true
      props.onPenDetected()
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })

    const touches = [...pointers.current.values()].filter((p) => p.type === 'touch')
    if (touches.length >= 2) {
      // second finger: drop the unfinished stroke and pinch-zoom
      capture(e)
      liveRef.current = null
      setLive(null)
      erasingRef.current = new Set()
      setErasing(new Set())
      lastErase.current = null
      const [a, b] = touches
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: viewRef.current }
      mode.current = { kind: 'pinch' }
      active.current = null
      return
    }
    const palm = e.pointerType === 'touch' && (penOnly || penSeen.current)
    if (e.button === 1 || space || tool === 'select' || tool === 'type' || palm) {
      capture(e)
      if ((tool === 'select' || tool === 'type') && e.button === 0 && !space && !palm) props.onSelectCard(null)
      const place = tool === 'type' && e.button === 0 && !space && !palm
      mode.current = { kind: 'pan', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, place }
      active.current = e.pointerId
      return
    }
    if (e.button !== 0 && e.pointerType === 'mouse') {
      pointers.current.delete(e.pointerId)
      return
    }
    capture(e)
    active.current = e.pointerId
    if (tool === 'eraser') {
      mode.current = { kind: 'erase' }
      lastErase.current = null
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
      const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      const list = evs.length ? evs : [e.nativeEvent]
      for (const ev of list) eraseAt(ev.clientX, ev.clientY)
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
      const next = { ...liveRef.current, pts }
      liveRef.current = next
      // A deferred pointermove must not resurrect a stroke that an interruption already dropped.
      setLive(() => (liveRef.current === next ? next : null))
    }
  }

  const endOwned = (e: React.PointerEvent, commit: boolean) => {
    pointers.current.delete(e.pointerId)
    const m = mode.current
    if (m?.kind === 'pinch') {
      if ([...pointers.current.values()].filter((p) => p.type === 'touch').length < 2) {
        pinch.current = null
        mode.current = null
        active.current = null
      }
      return
    }
    if (active.current !== null && e.pointerId !== active.current) return
    if (!m) return
    if (!commit) {
      abortLive()
      return
    }
    if (m.kind === 'pan' && m.place && Math.hypot(e.clientX - m.x0, e.clientY - m.y0) < 6) {
      const w = toWorld(e.clientX, e.clientY)
      props.onPlace(w.x, w.y)
    }
    if (m.kind === 'draw') finishStroke()
    if (m.kind === 'erase') finishErase()
    mode.current = null
    active.current = null
  }

  const onPointerUp = (e: React.PointerEvent) => endOwned(e, true)

  const onPointerCancel = (e: React.PointerEvent) => endOwned(e, false)

  const onLostPointerCapture = (e: React.PointerEvent) => {
    // pointerup releases capture and then fires this with the button already up.
    // A still-pressed pointer that lost capture was interrupted.
    if (e.buttons === 0) return
    if (active.current !== e.pointerId || !mode.current || mode.current.kind === 'pinch') return
    endOwned(e, false)
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
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
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
            onDragCancel={props.onCardDragCancel}
            onPlot={props.onPlot}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        ))}
        <svg data-ink="" className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
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
