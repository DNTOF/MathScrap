import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { hitSweep } from '@/ink/capsule'
import { inkDebugStats, type InkDebugStats } from '@/ink/debug'
import { inkFlagsStore } from '@/ink/flags'
import {
  ADAPTIVE_DEFAULT_FRAME_MS,
  PREDICTION_HISTORY_CAP,
  frameAdaptivePrediction,
  gateSamples,
  nativePredictedTail,
  predictionTailPath,
  predictTail,
  type InkSample,
} from '@/ink/predict'
import {
  appendStrokePoint,
  createIncrementalSmooth,
  midpointBezierPolyline,
  SMOOTH_MIN_DIST_DIP,
  updateIncrementalSmooth,
  type IncrementalSmoothState,
} from '@/ink/smooth'
import { dragThresholdWorld, hasRealPressure, hitToleranceWorld, isTapStroke, toPointerKind } from '@/ink/tolerance'
import { blockBoardSelection, ignoreBoardDoubleClick, suppressBoardTouch } from '@/ink/inputGuard'
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

type Mode = { kind: 'draw' } | { kind: 'erase'; lx: number; ly: number } | { kind: 'pan'; x: number; y: number; x0: number; y0: number; place: boolean } | { kind: 'pinch' }

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
  // ink-feel experiment switches — all opt-in, off by default (see src/ink/flags.ts);
  // live via the flags store so the debug panel can toggle them mid-stroke
  const flags = useSyncExternalStore(inkFlagsStore.subscribe, inkFlagsStore.get)
  const [predTail, setPredTail] = useState<number[]>([])
  const samplesRef = useRef<InkSample[]>([])
  const pointerTypeRef = useRef('mouse')
  const [wetPts, setWetPts] = useState<number[] | null>(null)
  const incSmoothRef = useRef<IncrementalSmoothState | null>(null)
  const frameMsRef = useRef(ADAPTIVE_DEFAULT_FRAME_MS)

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
    samplesRef.current = []
    incSmoothRef.current = null
    if (!busy) return
    setLive(null)
    setErasing(new Set())
    setPredTail([])
    setWetPts(null)
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

  // Touch WebKit (iPad): pointer events fire first, then touch events. Cancelling the touches that
  // became ink, erasing or a pinch stops iOS from synthesising click/dblclick (which opened the
  // composer), starting a text selection, or showing the callout / loupe. Text fields keep theirs.
  const toolRef = useRef(tool)
  useLayoutEffect(() => {
    toolRef.current = tool
  }, [tool])
  useEffect(() => {
    const el = ref.current!
    const held = new Set<number>()
    const elementOf = (t: EventTarget | null) => (t instanceof Node && !(t instanceof Element) ? t.parentElement : t)
    const onTouchStart = (e: TouchEvent) => {
      if (!suppressBoardTouch(toolRef.current, mode.current?.kind ?? null, elementOf(e.target))) return
      for (const t of Array.from(e.changedTouches)) held.add(t.identifier)
      if (e.cancelable) e.preventDefault()
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!held.size) return
      if (Array.from(e.changedTouches).some((t) => held.has(t.identifier)) && e.cancelable) e.preventDefault()
    }
    const onTouchEnd = (e: TouchEvent) => {
      let mine = false
      for (const t of Array.from(e.changedTouches)) mine = held.delete(t.identifier) || mine
      if (mine && e.cancelable) e.preventDefault()
    }
    const onSelectStart = (e: Event) => {
      if (blockBoardSelection(elementOf(e.target))) e.preventDefault()
    }
    // A stroke that wanders over the toolbar or a panel must not select it either.
    const onDocSelectStart = (e: Event) => {
      const kind = mode.current?.kind
      if ((kind === 'draw' || kind === 'erase' || kind === 'pinch') && blockBoardSelection(elementOf(e.target))) e.preventDefault()
    }
    const opts = { passive: false } as const
    el.addEventListener('touchstart', onTouchStart, opts)
    el.addEventListener('touchmove', onTouchMove, opts)
    el.addEventListener('touchend', onTouchEnd, opts)
    el.addEventListener('touchcancel', onTouchEnd, opts)
    el.addEventListener('selectstart', onSelectStart)
    document.addEventListener('selectstart', onDocSelectStart)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('selectstart', onSelectStart)
      document.removeEventListener('selectstart', onDocSelectStart)
    }
  }, [])

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

  // estimate the display refresh from rAF deltas so the prediction step/horizon
  // can scale with the panel (only runs while the prediction experiment is on)
  useEffect(() => {
    if (!flags.prediction) return
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      const d = t - last
      last = t
      if (d > 0 && d < 100) frameMsRef.current = frameMsRef.current * 0.8 + d * 0.2
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [flags.prediction])

  // a lone dot waits a moment before it is inked, so the two clicks of a double-click leave no marks
  const pendingDots = useRef<{ s: Stroke; t: ReturnType<typeof setTimeout> }[]>([])
  const [dots, setDots] = useState<Stroke[]>([])
  const finishStroke = () => {
    const s = liveRef.current
    liveRef.current = null
    setLive(null)
    samplesRef.current = []
    incSmoothRef.current = null
    if (predTail.length) setPredTail([]) // predicted points are display-only, never saved
    if (wetPts) setWetPts(null)
    if (!s || s.pts.length < 3) return
    let stroke = s
    // pointer-tolerance experiment: a quick press whose whole gesture stays
    // within the per-type drag threshold (÷ zoom) is a tap — collapse it to the
    // pen-down point. Slow deliberate ticks keep their (short) stroke.
    if (flags.pointerTolerance && stroke.pts.length > 3 && isTapStroke(stroke.pts, dragThresholdWorld(toPointerKind(pointerTypeRef.current), viewRef.current.scale), Date.now() - stroke.createdAt)) {
      stroke = { ...stroke, pts: [stroke.pts[0], stroke.pts[1], stroke.pts[2]] }
    }
    // bake the midpoint-Bézier smoothing into the saved stroke (dots and
    // two-point strokes come back unchanged from midpointBezierPolyline)
    const smooth = flags.smoothing ? midpointBezierPolyline(stroke.pts) : stroke.pts
    const final = smooth === stroke.pts ? stroke : { ...stroke, pts: smooth }
    if (final.pts.length > 3) return props.onAddStroke(final)
    const t = setTimeout(() => {
      pendingDots.current = pendingDots.current.filter((d) => d.s !== final)
      setDots(pendingDots.current.map((d) => d.s))
      props.onAddStroke(final)
    }, 320)
    pendingDots.current.push({ s: final, t })
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

  // eraser radius: main's eraserWorldRadius, or the per-pointer-type hit
  // tolerance (DIP ÷ zoom) under the pointerTolerance experiment
  const eraseRadius = () =>
    flags.pointerTolerance ? hitToleranceWorld(toPointerKind(pointerTypeRef.current), viewRef.current.scale) : eraserWorldRadius(viewRef.current.scale)

  const eraseAt = (cx: number, cy: number) => {
    const w = toWorld(cx, cy)
    const r = eraseRadius()
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

  // capsule the eraser swept through since the previous position, so fast motion
  // cannot skip over a stroke the point test would miss
  const eraseSweep = (x0: number, y0: number, x1: number, y1: number) => {
    const r = eraseRadius()
    let changed = false
    for (const s of doc.strokes) {
      if (!erasingRef.current.has(s.id) && hitSweep(s, x0, y0, x1, y1, r)) {
        erasingRef.current.add(s.id)
        changed = true
      }
    }
    if (changed) setErasing(new Set(erasingRef.current))
  }

  /** display-only extrapolated tail for the live stroke; never touches the stroke data */
  const updatePrediction = (e: React.PointerEvent, list: PointerEvent[]): number => {
    const hist = samplesRef.current
    for (const ev of list) {
      const last = hist[hist.length - 1]
      if (ev.timeStamp >= (last ? last.t : -Infinity)) hist.push({ x: ev.clientX, y: ev.clientY, t: ev.timeStamp })
    }
    if (hist.length > PREDICTION_HISTORY_CAP) hist.splice(0, hist.length - PREDICTION_HISTORY_CAP)
    const gate = gateSamples(hist)
    let screen: { x: number; y: number }[] = []
    let source: InkDebugStats['predictedSource'] = 'off'
    if (gate.predict) {
      const native = nativePredictedTail(e.nativeEvent).map((p) => ({ x: p.clientX, y: p.clientY }))
      if (native.length) {
        screen = native
        source = 'native'
      } else {
        // step/horizon scale with the display's frame interval (rAF estimate),
        // absolute cap preserved inside predictTail
        const adapt = frameAdaptivePrediction(frameMsRef.current)
        const horizon = gate.verdict === 'curve' ? adapt.curveHorizonMs : adapt.horizonMs
        screen = predictTail(hist, { horizonMs: horizon, stepMs: adapt.stepMs }).map((s) => ({ x: s.x, y: s.y }))
        source = 'self'
      }
    }
    inkDebugStats.predictedCount = screen.length
    inkDebugStats.predictedSource = source
    if (!screen.length || !liveRef.current) {
      if (predTail.length) setPredTail([])
      return screen.length
    }
    const pressure = liveRef.current.pts[liveRef.current.pts.length - 1] ?? 0.5
    const flat: number[] = []
    for (const p of screen) {
      const w = toWorld(p.x, p.y)
      flat.push(w.x, w.y, pressure)
    }
    setPredTail(flat)
    return screen.length
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-board]')) return
    pointerTypeRef.current = e.pointerType
    inkDebugStats.pointerType = e.pointerType
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
      incSmoothRef.current = null
      if (predTail.length) setPredTail([])
      if (wetPts) setWetPts(null)
      const [a, b] = touches
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: viewRef.current }
      mode.current = { kind: 'pinch' }
      active.current = null
      return
    }
    // A palm or a second contact must not steal a stroke that is already on the paper.
    if ((mode.current?.kind === 'draw' || mode.current?.kind === 'erase') && active.current !== null && e.pointerId !== active.current) {
      capture(e)
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
      const w = toWorld(e.clientX, e.clientY)
      mode.current = { kind: 'erase', lx: w.x, ly: w.y }
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
    incSmoothRef.current = null
    if (wetPts) setWetPts(null)
    if (flags.prediction) samplesRef.current = [{ x: e.clientX, y: e.clientY, t: e.nativeEvent.timeStamp }]
    mode.current = { kind: 'draw' }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    const m = mode.current
    if (!m) return
    if (m.kind !== 'pinch' && active.current !== null && e.pointerId !== active.current) return
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
      if (flags.capsuleEraser) {
        const w = toWorld(e.clientX, e.clientY)
        eraseSweep(m.lx, m.ly, w.x, w.y)
        m.lx = w.x
        m.ly = w.y
      } else {
        const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
        const list = evs.length ? evs : [e.nativeEvent]
        for (const ev of list) eraseAt(ev.clientX, ev.clientY)
      }
      return
    }
    if (m.kind === 'draw' && liveRef.current) {
      const t0 = performance.now()
      const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      const list = evs.length ? evs : [e.nativeEvent]
      // flags off → the exact main behaviour: looser 0.8 px near-point threshold, no prediction
      const minDist = flags.smoothing ? SMOOTH_MIN_DIST_DIP : 0.8
      let pts = liveRef.current.pts.slice()
      for (const ev of list) {
        const w = toWorld(ev.clientX, ev.clientY)
        pts = appendStrokePoint(pts, { x: w.x, y: w.y, pressure: ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5 }, minDist, viewRef.current.scale)
      }
      const next = { ...liveRef.current, pts }
      liveRef.current = next
      // A deferred pointermove must not resurrect a stroke that an interruption already dropped.
      setLive(() => (liveRef.current === next ? next : null))
      // wet-ink incremental redraw: extend the cached smooth polyline by the one
      // newly-final segment instead of resampling the whole stroke per frame
      if (flags.smoothing && flags.wetIncremental) {
        const st = incSmoothRef.current ?? (incSmoothRef.current = createIncrementalSmooth())
        updateIncrementalSmooth(st, pts)
        setWetPts(st.pts)
      } else if (wetPts) {
        setWetPts(null)
      }
      if (flags.prediction) updatePrediction(e, list)
      else if (predTail.length) setPredTail([])
      // debug-panel bookkeeping (hidden unless ?ink-debug=1; no behaviour change)
      inkDebugStats.nativePredicted = typeof e.nativeEvent.getPredictedEvents === 'function'
      inkDebugStats.hasPressure = hasRealPressure(liveRef.current.pts)
      inkDebugStats.strokePoints = liveRef.current.pts.length / 3
      inkDebugStats.handlerMs = performance.now() - t0
      inkDebugStats.lastMoveAt = t0
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
  // wet-ink display: smoothing and the predicted tail are overlays on the live
  // stroke only — they never mutate liveRef, which is what gets saved
  const PREDICTION_GHOST_OPACITY = 0.4
  const wetBase = live ? (flags.smoothing ? (flags.wetIncremental && wetPts ? wetPts : midpointBezierPolyline(live.pts)) : live.pts) : null
  const liveDisplay = (() => {
    if (!live || wetBase == null) return null
    const merged = flags.prediction && predTail.length && !flags.predictionGhost
    if (!merged) return wetBase === live.pts ? live : { ...live, pts: wetBase }
    return { ...live, pts: [...wetBase, ...predTail] }
  })()
  // ghost tail: the prediction rendered as its own translucent path, starting at the stroke tip
  const tailDisplay = (() => {
    if (!live || wetBase == null || !flags.prediction || !flags.predictionGhost || !predTail.length) return null
    return { ...live, pts: predictionTailPath(wetBase, predTail) }
  })()
  const fingerSelects = penOnly || penSeen.current
  const passThrough = useCallback(
    (e: React.PointerEvent) => (drawing || space) && !(e.pointerType === 'touch' && fingerSelects),
    [drawing, space, fingerSelects],
  )
  const cursor = space || tool === 'select' ? 'grab' : tool === 'type' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair'

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-board]')) return
    // iOS turns two quick taps or short marks (a dot, the bars of "=") into a dblclick. With an ink
    // tool only a mouse double-click opens the composer; a pen or capacitive stylus (touch) never does.
    if (ignoreBoardDoubleClick(tool, pointerTypeRef.current)) return
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
      style={{ touchAction: 'none', cursor, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}
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
        <svg data-ink="" className="pointer-events-none absolute top-0 left-0 overflow-visible select-none" width="1" height="1" style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
          <StrokeDefs />
          {doc.strokes.map((s) => (
            <g key={s.id} opacity={erasing.has(s.id) ? 0.15 : 1}>
              <StrokeShape s={s} />
            </g>
          ))}
          {dots.map((s) => (
            <StrokeShape key={s.id} s={s} />
          ))}
          {liveDisplay && <StrokeShape s={liveDisplay} />}
          {tailDisplay && (
            <g opacity={PREDICTION_GHOST_OPACITY}>
              <StrokeShape s={tailDisplay} />
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
