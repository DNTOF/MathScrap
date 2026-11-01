import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type PlotlyLib = typeof import('plotly.js-dist-min')
let plotlyPromise: Promise<PlotlyLib> | null = null
const loadPlotly = () => (plotlyPromise ??= import('plotly.js-dist-min').then((m) => ((m as unknown as { default?: PlotlyLib }).default ?? m) as PlotlyLib))

interface Props {
  data: Record<string, unknown>[]
  layout: Record<string, unknown>
  /** called with the visible x / y range after the user pans or zooms (2D only) */
  onRange?: (x: [number, number], y: [number, number]) => void
  resetKey: string
  /** fired once after the first successful draw — the progressive reveal waits for it */
  onReady?: () => void
  /** corner picture: the chart only, no mode bar */
  bare?: boolean
}

type PlotDiv = HTMLDivElement & { on?: (ev: string, cb: (e: Record<string, unknown>) => void) => void; layout?: { xaxis?: { range?: number[] }; yaxis?: { range?: number[] } } }

export function PlotView({ data, layout, onRange, resetKey, onReady, bare }: Props) {
  const ref = useRef<PlotDiv>(null)
  const [lib, setLib] = useState<PlotlyLib | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onRangeRef = useRef(onRange)
  onRangeRef.current = onRange
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const bound = useRef(false)
  const fired = useRef(false)

  useEffect(() => {
    loadPlotly().then(setLib, (e) => setError(String(e)))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!lib || !el) return
    const config = {
      responsive: true,
      scrollZoom: true,
      displaylogo: false,
      displayModeBar: bare ? false : undefined,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian', 'resetCameraLastSave3d'],
    }
    lib.react(el, data as never, layout as never, config as never)
    if (!fired.current) {
      fired.current = true
      onReadyRef.current?.()
    }
    if (!bound.current && el.on) {
      bound.current = true
      let t: ReturnType<typeof setTimeout> | undefined
      el.on('plotly_relayout', () => {
        clearTimeout(t)
        t = setTimeout(() => {
          const xr = el.layout?.xaxis?.range
          const yr = el.layout?.yaxis?.range
          if (xr && yr && onRangeRef.current) onRangeRef.current([+xr[0], +xr[1]], [+yr[0], +yr[1]])
        }, 120)
      })
    }
  }, [lib, data, layout, bare])

  // a different object set should start from a fresh view
  useEffect(() => {
    const el = ref.current
    return () => {
      if (el && lib) {
        lib.purge(el)
        bound.current = false
      }
    }
  }, [resetKey, lib])

  useEffect(() => {
    const el = ref.current
    if (!el || !lib) return
    const ro = new ResizeObserver(() => lib.Plots.resize(el))
    ro.observe(el)
    return () => ro.disconnect()
  }, [lib])

  return (
    <div className="relative h-full w-full" data-no-board>
      <div ref={ref} className="h-full w-full" />
      {!lib && !error && (
        <div className="absolute inset-0 grid place-items-center text-sm text-kraft-700">
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> 正在铺开坐标纸…
          </span>
        </div>
      )}
      {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-red">绘图库加载失败：{error}</div>}
    </div>
  )
}
