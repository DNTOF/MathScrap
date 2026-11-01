import type { Analysis, PlotObj } from '@/math/scene'
import { engine, type Env, type RustShape } from '@/wasm/engine'
import type { Camera3 } from './remoteView'

type Trace = Record<string, unknown>
type Layout = Record<string, unknown>

export interface Ranges {
  x: [number, number]
  y: [number, number]
}

const INK = '#2e2116'
const GRID = 'rgba(90, 60, 30, 0.16)'
const AXIS = 'rgba(60, 35, 15, 0.6)'
const PAPER = '#efe2c8'
const FONT = { family: 'Geist Variable, PingFang SC, Microsoft YaHei, sans-serif', color: INK, size: 12 }

const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function paramRange(comps: string[]): [number, number] {
  return comps.some((c) => /sin|cos|tan/.test(c)) ? [0, 4 * Math.PI] : [-5, 5]
}

/** Curve samples with gaps at NaN and at asymptote jumps. */
function curveXY(expr: string, env: Env, a: number, b: number, span: number) {
  const n = 1600
  const ys = engine.sampleCurve(expr, 'x', env, a, b, n)
  const xs = linspace(a, b, n)
  const outX: (number | null)[] = []
  const outY: (number | null)[] = []
  let prev = NaN
  for (let i = 0; i < n; i++) {
    const y = ys[i]
    if (!Number.isFinite(y)) {
      outX.push(null)
      outY.push(null)
      prev = NaN
      continue
    }
    if (Number.isFinite(prev) && Math.abs(y - prev) > span * 1.5 && Math.sign(y) !== Math.sign(prev)) {
      outX.push(null)
      outY.push(null)
    }
    outX.push(xs[i])
    outY.push(y)
    prev = y
  }
  return { x: outX, y: outY }
}

function collectBounds(a: Analysis, shapes: RustShape[]) {
  const xs: number[] = []
  const ys: number[] = []
  const add = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x)
      ys.push(y)
    }
  }
  for (const o of a.objects) {
    if (o.type === 'points') o.pts.forEach((p) => add(p.p[0], p.p[1] ?? 0))
    if (o.type === 'triangle') o.verts.forEach(([x, y]) => add(x, y))
    if (o.type === 'vector') {
      add(0, 0)
      add(o.v[0], o.v[1])
    }
    if (o.type === 'marks') o.pts.forEach((p) => add(p.p[0], p.p[1]))
    if (o.type === 'circle') {
      add(o.cx - o.r, o.cy - o.r)
      add(o.cx + o.r, o.cy + o.r)
    }
    if (o.type === 'circleCase') {
      add(o.p[0], o.p[1])
      for (const L of o.lines) {
        add(L.a[0], L.a[1])
        add(L.b[0], L.b[1])
      }
    }
  }
  for (const s of a.sections.flatMap((s) => s.facts)) {
    const sh = s.shape
    if (!sh) continue
    if (sh.type === 'circle') {
      add(sh.cx - sh.r, sh.cy - sh.r)
      add(sh.cx + sh.r, sh.cy + sh.r)
    } else if (sh.type === 'point' && (sh.label === '圆心' || sh.label === '中心' || sh.label.startsWith('F'))) add(sh.x, sh.y)
  }
  for (const sh of shapes) if (sh.type === 'point') add(sh.x, sh.y)
  for (const o of a.objects) if (o.type === 'implicit2') zeroSetBox(o.F, a.env)?.forEach(([x, y]) => add(x, y))
  return { xs, ys }
}

/** Corners of the zero set of F(x, y) on a coarse grid, when the curve is bounded (ellipse, circle, closed loops). */
function zeroSetBox(F: string, env: Env): [number, number][] | null {
  const n = 161
  const L = 20
  const z = engine.sampleGrid(F, 'x', 'y', env, -L, L, -L, L, n, n)
  const step = (2 * L) / (n - 1)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const v = z[j * n + i]
      const r = z[j * n + i + 1]
      const u = z[(j + 1) * n + i]
      if (!Number.isFinite(v)) continue
      if ((Number.isFinite(r) && Math.sign(v) !== Math.sign(r)) || (Number.isFinite(u) && Math.sign(v) !== Math.sign(u))) {
        const x = -L + i * step
        const y = -L + j * step
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x + step)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y + step)
      }
    }
  if (!Number.isFinite(x0) || x0 <= -L + 2 * step || x1 >= L - 2 * step || y0 <= -L + 2 * step || y1 >= L - 2 * step) return null
  return [
    [x0, y0],
    [x1, y1],
  ]
}

function percentile(sorted: number[], t: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(t * (sorted.length - 1))))]
}

/** Points the eye should land on: zeros, extrema, intercepts, intersections, roots, given points. */
function keyPoints(a: Analysis): [number, number][] {
  const out: [number, number][] = []
  const add = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e6 && Math.abs(y) < 1e6 && out.push([x, y])
  for (const f of a.sections.flatMap((s) => s.facts)) if (f.shape?.type === 'point') add(f.shape.x, f.shape.y)
  for (const o of a.objects) {
    if (o.type === 'marks') o.pts.forEach((p) => add(p.p[0], p.p[1]))
    if (o.type === 'roots') o.xs.forEach((x) => add(x, 0))
    if (o.type === 'points') o.pts.forEach((p) => add(p.p[0], p.p[1] ?? 0))
  }
  return out
}

/**
 * Initial 2D window. Geometry fits its bounding box at 1:1. Functions frame their key
 * points, then fit y to the curves inside that x-window, capping the y-span relative
 * to the x-span so steep curves (x³, eˣ) don't flatten everything else into a line.
 */
export function initialRanges(a: Analysis): Ranges {
  const { xs, ys } = collectBounds(a, [])
  for (const o of a.objects) if (o.type === 'roots') o.xs.forEach((x) => (xs.push(x), ys.push(0)))
  if (xs.length >= 2 && a.equalAspect) {
    const x0 = Math.min(...xs, 0)
    const x1 = Math.max(...xs, 0)
    const y0 = Math.min(...ys, 0)
    const y1 = Math.max(...ys, 0)
    const pad = Math.max(x1 - x0, y1 - y0) * 0.18 + 0.8
    return { x: [x0 - pad, x1 + pad], y: [y0 - pad, y1 + pad] }
  }

  const curves = a.objects.filter((o): o is Extract<PlotObj, { type: 'curve' }> => o.type === 'curve')
  const periodic = curves.some((c) => engine.roots(c.expr, 'x', a.env, -20, 20).length > 12)
  let keys = keyPoints(a)
  if (keys.length > 10) keys = [...keys].sort((p, q) => Math.hypot(...p) - Math.hypot(...q)).slice(0, 10)

  let x: [number, number]
  if (periodic) x = [-2 * Math.PI - 0.6, 2 * Math.PI + 0.6]
  else if (keys.length) {
    let lo = Math.min(...keys.map((k) => k[0]))
    let hi = Math.max(...keys.map((k) => k[0]))
    if (lo > 0 && lo < 8) lo = 0
    if (hi < 0 && hi > -8) hi = 0
    const pad = Math.max(2, (hi - lo) * 0.35)
    x = [lo - pad, hi + pad]
  } else x = [-6, 6]
  if (x[1] - x[0] < 8) {
    const m = (x[0] + x[1]) / 2
    x = [m - 4, m + 4]
  }
  const wx = x[1] - x[0]

  const vals: number[] = []
  for (const c of curves) engine.sampleCurve(c.expr, 'x', a.env, x[0], x[1], 600).forEach((v) => Number.isFinite(v) && vals.push(v))
  const keyYs = keys.filter((k) => k[0] >= x[0] && k[0] <= x[1]).map((k) => k[1])
  if (!vals.length && !keyYs.length) return { x, y: [-wx / 2, wx / 2] }
  vals.sort((p, q) => p - q)
  let lo = Math.min(vals.length ? percentile(vals, 0.02) : Infinity, ...keyYs)
  let hi = Math.max(vals.length ? percentile(vals, 0.98) : -Infinity, ...keyYs)
  const maxSpan = Math.max(8, wx * 2)
  if (hi - lo > maxSpan) {
    const kLo = keyYs.length ? Math.min(...keyYs) : 0
    const kHi = keyYs.length ? Math.max(...keyYs) : 0
    if (kHi - kLo >= maxSpan) [lo, hi] = [kLo, kHi]
    else {
      // slide a maxSpan window that keeps the key points, toward where the curve has data
      const below = vals.filter((v) => v < kLo).length
      const above = vals.filter((v) => v > kHi).length
      const room = maxSpan - (kHi - kLo)
      const share = below + above ? below / (below + above) : 0.5
      lo = kLo - room * share
      hi = kHi + room * (1 - share)
    }
  }
  if (lo > 0 && lo < (hi - lo) * 0.6) lo = 0
  if (hi < 0 && -hi < (hi - lo) * 0.6) hi = 0
  if (hi - lo < 4) {
    const m = (hi + lo) / 2
    lo = m - 2
    hi = m + 2
  }
  const pad = (hi - lo) * 0.1
  return { x, y: [lo - pad, hi + pad] }
}

function shapeTraces2d(shapes: RustShape[]): Trace[] {
  const out: Trace[] = []
  for (const s of shapes) {
    if (s.type === 'point')
      out.push({ type: 'scatter', mode: 'markers+text', x: [s.x], y: [s.y], text: [s.label], textposition: 'top right', marker: { symbol: 'star', size: 13, color: '#b9852a', line: { color: INK, width: 1 } }, name: s.label, showlegend: false, hovertemplate: `${s.label}<br>(%{x:.4f}, %{y:.4f})<extra></extra>` })
    if (s.type === 'circle') {
      const t = linspace(0, 2 * Math.PI, 200)
      out.push({ type: 'scatter', mode: 'lines', x: t.map((u) => s.cx + s.r * Math.cos(u)), y: t.map((u) => s.cy + s.r * Math.sin(u)), line: { color: '#b9852a', width: 2, dash: 'dash' }, name: s.label, hoverinfo: 'name' })
    }
    if (s.type === 'segment')
      out.push({ type: 'scatter', mode: 'lines', x: [s.x1, s.x2], y: [s.y1, s.y2], line: { color: '#b9852a', width: 2.2, dash: 'dot' }, name: s.label, hoverinfo: 'name' })
  }
  return out
}

export function buildFigure2d(a: Analysis, r: Ranges, shapes: RustShape[], revision = 'keep'): { data: Trace[]; layout: Layout } {
  const data: Trace[] = []
  const annotations: Record<string, unknown>[] = []
  const spanY = r.y[1] - r.y[0]
  const wx = r.x[1] - r.x[0]
  const sx: [number, number] = [r.x[0] - wx * 0.5, r.x[1] + wx * 0.5]
  const wy = r.y[1] - r.y[0]
  const sy: [number, number] = [r.y[0] - wy * 0.5, r.y[1] + wy * 0.5]

  for (const o of a.objects) {
    switch (o.type) {
      case 'curve': {
        const { x, y } = curveXY(o.expr, a.env, sx[0], sx[1], spanY)
        data.push({ type: 'scatter', mode: 'lines', x, y, name: `${o.name}(x)`, line: { color: o.color, width: 2.6, shape: 'spline', smoothing: 0.4 }, hovertemplate: `${o.name}: (%{x:.3f}, %{y:.3f})<extra></extra>` })
        break
      }
      case 'implicit2': {
        const n = 240
        const z = engine.sampleGrid(o.F, 'x', 'y', a.env, sx[0], sx[1], sy[0], sy[1], n, n)
        const rows: (number | null)[][] = []
        for (let j = 0; j < n; j++) rows.push(Array.from(z.subarray(j * n, (j + 1) * n), (v) => (Number.isFinite(v) ? v : null)))
        data.push({
          type: 'contour',
          x: linspace(sx[0], sx[1], n),
          y: linspace(sy[0], sy[1], n),
          z: rows,
          contours: { start: 0, end: 0, size: 1, coloring: 'lines' },
          colorscale: [
            [0, o.color],
            [1, o.color],
          ],
          line: { width: 2.6 },
          showscale: false,
          name: o.name,
          showlegend: true,
          hoverinfo: 'skip',
        })
        break
      }
      case 'points':
        if (o.polygon) {
          const xs = [...o.pts.map((p) => p.p[0]), o.pts[0].p[0]]
          const ys = [...o.pts.map((p) => p.p[1]), o.pts[0].p[1]]
          data.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, fill: 'toself', fillcolor: 'rgba(47, 74, 109, 0.08)', line: { color: '#2f4a6d', width: 2.4 }, name: o.pts.map((p) => p.name).join(''), hoverinfo: 'skip' })
        }
        data.push({ type: 'scatter', mode: 'markers+text', x: o.pts.map((p) => p.p[0]), y: o.pts.map((p) => p.p[1]), text: o.pts.map((p) => p.name), textposition: 'top left', textfont: { size: 15, color: INK }, marker: { size: 9, color: INK }, name: '点', showlegend: false, hovertemplate: '%{text} (%{x:.4f}, %{y:.4f})<extra></extra>' })
        break
      case 'triangle': {
        const [A, B, C] = o.verts
        data.push({ type: 'scatter', mode: 'lines', x: [A[0], B[0], C[0], A[0]], y: [A[1], B[1], C[1], A[1]], fill: 'toself', fillcolor: hexA(o.color, 0.08), line: { color: o.color, width: 2.6, dash: o.dashed ? 'dash' : 'solid' }, name: `△${o.names}${o.dashed ? '（另一解）' : ''}`, hoverinfo: 'skip' })
        data.push({ type: 'scatter', mode: 'markers+text', x: [A[0], B[0], C[0]], y: [A[1], B[1], C[1]], text: o.names.split(''), textposition: ['bottom left', 'bottom right', 'top center'], textfont: { size: 15, color: INK }, marker: { size: 8, color: o.color }, showlegend: false, hovertemplate: '%{text} (%{x:.4f}, %{y:.4f})<extra></extra>' })
        const lower = o.names.toLowerCase()
        const mids = [
          [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2, lower[0]],
          [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2, lower[1]],
          [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, lower[2]],
        ] as const
        data.push({ type: 'scatter', mode: 'text', x: mids.map((m) => m[0]), y: mids.map((m) => m[1]), text: mids.map((m) => m[2]), textfont: { size: 14, color: o.color, family: 'Caveat, cursive' }, showlegend: false, hoverinfo: 'skip' })
        break
      }
      case 'vector':
        annotations.push({ x: o.v[0], y: o.v[1], ax: 0, ay: 0, xref: 'x', yref: 'y', axref: 'x', ayref: 'y', showarrow: true, arrowhead: 2, arrowsize: 1.3, arrowwidth: 2.4, arrowcolor: o.color, text: '' })
        data.push({ type: 'scatter', mode: 'text', x: [o.v[0]], y: [o.v[1]], text: [`  <b>${o.name}</b>`], textposition: 'middle right', textfont: { size: 15, color: o.color }, name: o.name, showlegend: false, hovertemplate: `${o.name} = (%{x}, %{y})<extra></extra>` })
        break
      case 'param': {
        const [t0, t1] = paramRange(o.comps)
        const xs = engine.sampleCurve(o.comps[0], 't', a.env, t0, t1, 800)
        const ys = engine.sampleCurve(o.comps[1], 't', a.env, t0, t1, 800)
        data.push({ type: 'scatter', mode: 'lines', x: Array.from(xs), y: Array.from(ys), line: { color: o.color, width: 2.6 }, name: `${o.name}(t)` })
        break
      }
      case 'roots':
        if (o.xs.length)
          data.push({ type: 'scatter', mode: 'markers+text', x: o.xs, y: o.xs.map(() => 0), text: o.xs.map((x) => `x=${+x.toFixed(4)}`), textposition: 'bottom center', textfont: { size: 12, color: '#9b3b2a' }, marker: { size: 11, symbol: 'diamond', color: '#9b3b2a', line: { color: INK, width: 1 } }, name: o.name, hovertemplate: 'x = %{x:.6f}<extra></extra>' })
        break
      case 'marks':
        data.push({ type: 'scatter', mode: 'markers', x: o.pts.map((p) => p.p[0]), y: o.pts.map((p) => p.p[1]), text: o.pts.map((p) => p.label), marker: { size: 12, symbol: 'circle-open', color: '#9b3b2a', line: { width: 2.6 } }, name: '交点', hovertemplate: '%{text}<br>(%{x:.4f}, %{y:.4f})<extra></extra>' })
        break
      case 'circle': {
        const t = linspace(0, 2 * Math.PI, 200)
        data.push({ type: 'scatter', mode: 'lines', x: t.map((u) => o.cx + o.r * Math.cos(u)), y: t.map((u) => o.cy + o.r * Math.sin(u)), line: { color: o.color, width: 2.6 }, name: `⊙${o.name}`, hovertemplate: `⊙${o.name}<br>(%{x:.3f}, %{y:.3f})<extra></extra>` })
        break
      }
      case 'circleCase': {
        for (const L of o.lines)
          data.push({ type: 'scatter', mode: 'lines', x: [L.a[0], L.b[0]], y: [L.a[1], L.b[1]], line: { color: o.color, width: 2.4, dash: o.dashed ? 'dash' : 'solid' }, name: `${L.names[0]}${L.names[1]}`, showlegend: false, hovertemplate: `${L.names[0]}${L.names[1]}<extra></extra>` })
        const seen = new Map<string, [number, number]>([[o.pName, o.p]])
        for (const L of o.lines) {
          if (!seen.has(L.names[0])) seen.set(L.names[0], L.a)
          if (!seen.has(L.names[1])) seen.set(L.names[1], L.b)
        }
        data.push({ type: 'scatter', mode: 'markers+text', x: [...seen.values()].map((p) => p[0]), y: [...seen.values()].map((p) => p[1]), text: [...seen.keys()], textposition: 'top right', textfont: { size: 15, color: INK }, marker: { size: 8, color: o.color }, showlegend: false, hovertemplate: '%{text} (%{x:.4f}, %{y:.4f})<extra></extra>' })
        break
      }
      default:
        break
    }
  }
  data.push(...shapeTraces2d(shapes))

  const axis = { gridcolor: GRID, zerolinecolor: AXIS, zerolinewidth: 1.6, linecolor: AXIS, tickcolor: AXIS, color: '#5f4128', mirror: false }
  const layout: Layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: PAPER,
    font: FONT,
    margin: { l: 44, r: 14, t: 10, b: 36 },
    dragmode: 'pan',
    hovermode: 'closest',
    showlegend: true,
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)', font: { size: 12 } },
    xaxis: { ...axis, range: r.x },
    yaxis: { ...axis, range: r.y, ...(a.equalAspect ? { scaleanchor: 'x', scaleratio: 1 } : {}) },
    annotations,
    uirevision: revision,
  }
  return { data, layout }
}

function bound3(a: Analysis, shapes: RustShape[]) {
  let m = 0
  for (const o of a.objects) {
    if (o.type === 'points') o.pts.forEach((p) => p.p.forEach((v) => (m = Math.max(m, Math.abs(v)))))
    if (o.type === 'vector') o.v.forEach((v) => (m = Math.max(m, Math.abs(v))))
  }
  for (const s of shapes) {
    if (s.type === 'point3') m = Math.max(m, Math.abs(s.x), Math.abs(s.y), Math.abs(s.z))
    if (s.type === 'arrow3') m = Math.max(m, Math.abs(s.x), Math.abs(s.y), Math.abs(s.z))
  }
  return Math.max(5, Math.ceil(m * 1.25))
}

/** Polygon where the plane n·p = d cuts the cube [-R, R]³, ordered around its centroid. */
function planeCubePolygon(n: number[], d: number, R: number): number[][] {
  const pts: number[][] = []
  const corners = [-R, R]
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [(axis + 1) % 3, (axis + 2) % 3]
    if (Math.abs(n[axis]) < 1e-12) continue
    for (const cu of corners)
      for (const cv of corners) {
        const t = (d - n[u] * cu - n[v] * cv) / n[axis]
        if (Math.abs(t) > R * (1 + 1e-9)) continue
        const p = [0, 0, 0]
        p[axis] = t
        p[u] = cu
        p[v] = cv
        if (!pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-9)) pts.push(p)
      }
  }
  if (pts.length < 3) return []
  const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length)
  const len = Math.hypot(n[0], n[1], n[2])
  const nn = n.map((v) => v / len)
  const e1 = cross(nn, Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
  const l1 = Math.hypot(e1[0], e1[1], e1[2])
  const u1 = e1.map((v) => v / l1)
  const u2 = cross(nn, u1)
  const ang = (p: number[]) => {
    const w = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
    return Math.atan2(dot(w, u2), dot(w, u1))
  }
  return pts.sort((p, q) => ang(p) - ang(q))
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function planeTraces(o: Extract<PlotObj, { type: 'plane' }>, R: number): Trace[] {
  const poly = planeCubePolygon(o.n, o.d, R)
  if (!poly.length) return []
  const k = poly.length
  const name = `平面 ${o.name}`
  const closed = [...poly, poly[0]]
  return [
    {
      type: 'mesh3d',
      x: poly.map((p) => p[0]),
      y: poly.map((p) => p[1]),
      z: poly.map((p) => p[2]),
      i: Array.from({ length: k - 2 }, () => 0),
      j: Array.from({ length: k - 2 }, (_, t) => t + 1),
      k: Array.from({ length: k - 2 }, (_, t) => t + 2),
      color: o.color,
      opacity: 0.45,
      flatshading: true,
      name,
      legendgroup: name,
      showlegend: true,
      hovertemplate: `${o.name}<br>(%{x:.2f}, %{y:.2f}, %{z:.2f})<extra></extra>`,
    },
    {
      type: 'scatter3d',
      mode: 'lines',
      x: closed.map((p) => p[0]),
      y: closed.map((p) => p[1]),
      z: closed.map((p) => p[2]),
      line: { color: o.color, width: 3 },
      legendgroup: name,
      showlegend: false,
      hoverinfo: 'skip',
    },
  ]
}

function arrow3(v: number[], color: string, name: string, dashed = false): Trace[] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [
    { type: 'scatter3d', mode: 'lines+text', x: [0, v[0]], y: [0, v[1]], z: [0, v[2]], text: ['', name], textposition: 'top center', textfont: { color, size: 14 }, line: { color, width: 7, dash: dashed ? 'dash' : 'solid' }, name, hovertemplate: `${name} = (${v.map((x) => +x.toFixed(4)).join(', ')})<extra></extra>` },
    {
      type: 'cone',
      x: [v[0]],
      y: [v[1]],
      z: [v[2]],
      u: [v[0] / len],
      v: [v[1] / len],
      w: [v[2] / len],
      anchor: 'tip',
      sizemode: 'absolute',
      sizeref: Math.max(0.35, len * 0.14),
      colorscale: [
        [0, color],
        [1, color],
      ],
      showscale: false,
      hoverinfo: 'skip',
      showlegend: false,
    },
  ]
}

/**
 * z-range for the 3D scene: [-R, R] for geometry; surfaces z = f(x, y) widen it to their
 * robust value range so a bowl like x² + y² isn't clipped at the cube's lid.
 */
function zRange3(a: Analysis, R: number, grids: Float64Array[]): [number, number] {
  if (!grids.length) return [-R, R]
  const vals: number[] = []
  grids.forEach((g) => g.forEach((v) => Number.isFinite(v) && vals.push(v)))
  if (!vals.length) return [-R, R]
  vals.sort((p, q) => p - q)
  let lo = percentile(vals, 0.01)
  let hi = percentile(vals, 0.99)
  const others = a.objects.some((o) => o.type !== 'surface')
  if (others) {
    lo = Math.min(lo, -R)
    hi = Math.max(hi, R)
  }
  if (hi - lo < 2) {
    const m = (hi + lo) / 2
    lo = m - 1
    hi = m + 1
  }
  const pad = (hi - lo) * 0.06
  return [lo - pad, hi + pad]
}

export function buildFigure3d(a: Analysis, shapes: RustShape[], opts?: { camera?: Camera3; z?: [number, number]; revision?: string }): { data: Trace[]; layout: Layout } {
  const data: Trace[] = []
  const R = bound3(a, shapes)
  const n3 = 72
  const grids = new Map<string, Float64Array>()
  for (const o of a.objects) if (o.type === 'surface') grids.set(o.name, engine.sampleGrid(o.expr, 'x', 'y', a.env, -R, R, -R, R, n3, n3))
  const zr = opts?.z ?? zRange3(a, R, [...grids.values()])
  const zSpan = zr[1] - zr[0]
  for (const o of a.objects) {
    switch (o.type) {
      case 'surface': {
        const n = n3
        const g = linspace(-R, R, n)
        const z = grids.get(o.name)!
        const rows: (number | null)[][] = []
        for (let j = 0; j < n; j++) rows.push(Array.from(z.subarray(j * n, (j + 1) * n), (v) => (Number.isFinite(v) && v > zr[0] - zSpan && v < zr[1] + zSpan ? v : null)))
        data.push({
          type: 'surface',
          x: g,
          y: g,
          z: rows,
          colorscale: [
            [0, '#2f4a6d'],
            [0.5, '#c9a473'],
            [1, '#9b3b2a'],
          ],
          showscale: false,
          opacity: 0.94,
          name: `z = ${o.name}(x, y)`,
          showlegend: true,
          contours: { z: { show: true, usecolormap: true, project: { z: true }, width: 1 } },
          lighting: { ambient: 0.75, diffuse: 0.6, specular: 0.08, roughness: 0.9 },
          hovertemplate: '(%{x:.2f}, %{y:.2f}) → z = %{z:.3f}<extra></extra>',
        })
        break
      }
      case 'plane':
        data.push(...planeTraces(o, R))
        break
      case 'implicit3': {
        const n = 34
        const vals = engine.sampleVolume(o.F, a.env, -R, R, n)
        const g = linspace(-R, R, n)
        const xs: number[] = []
        const ys: number[] = []
        const zs: number[] = []
        for (let k = 0; k < n; k++)
          for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
              xs.push(g[i])
              ys.push(g[j])
              zs.push(g[k])
            }
        data.push({
          type: 'isosurface',
          x: xs,
          y: ys,
          z: zs,
          value: Array.from(vals, (v) => (Number.isFinite(v) ? v : 1e6)),
          isomin: 0,
          isomax: 0,
          surface: { count: 1 },
          caps: { x: { show: false }, y: { show: false }, z: { show: false } },
          colorscale: [
            [0, o.color],
            [1, o.color],
          ],
          showscale: false,
          opacity: 0.7,
          name: o.name,
          showlegend: true,
          hoverinfo: 'skip',
        })
        break
      }
      case 'points':
        data.push({ type: 'scatter3d', mode: 'markers+text', x: o.pts.map((p) => p.p[0]), y: o.pts.map((p) => p.p[1]), z: o.pts.map((p) => p.p[2] ?? 0), text: o.pts.map((p) => p.name), textposition: 'top center', marker: { size: 5, color: INK }, name: '点', textfont: { size: 14 } })
        if (o.polygon) {
          const loop = [...o.pts, o.pts[0]]
          data.push({ type: 'scatter3d', mode: 'lines', x: loop.map((p) => p.p[0]), y: loop.map((p) => p.p[1]), z: loop.map((p) => p.p[2] ?? 0), line: { color: '#2f4a6d', width: 5 }, name: '连线', hoverinfo: 'skip' })
        }
        break
      case 'vector':
        data.push(...arrow3([o.v[0], o.v[1], o.v[2] ?? 0], o.color, /^[A-Z]{2}$/.test(o.name) ? o.name : `<b>${o.name}</b>`))
        break
      case 'param': {
        const [t0, t1] = paramRange(o.comps)
        const cs = o.comps.map((c) => Array.from(engine.sampleCurve(c, 't', a.env, t0, t1, 900)))
        data.push({ type: 'scatter3d', mode: 'lines', x: cs[0], y: cs[1], z: cs[2] ?? cs[0].map(() => 0), line: { color: o.color, width: 7 }, name: `${o.name}(t)` })
        break
      }
      default:
        break
    }
  }
  for (const s of shapes) {
    if (s.type === 'point3') data.push({ type: 'scatter3d', mode: 'markers+text', x: [s.x], y: [s.y], z: [s.z], text: [s.label], textposition: 'top center', marker: { size: 6, symbol: 'diamond', color: '#b9852a' }, name: s.label, showlegend: false })
    if (s.type === 'line3') {
      const L = R * 2.2
      const n = Math.hypot(s.dx, s.dy, s.dz) || 1
      const [ux, uy, uz] = [s.dx / n, s.dy / n, s.dz / n]
      const pts = linspace(-L, L, 80).map((t) => [s.px + ux * t, s.py + uy * t, s.pz + uz * t]).filter((p) => p.every((v) => Math.abs(v) <= R))
      data.push({ type: 'scatter3d', mode: 'lines', x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), z: pts.map((p) => p[2]), line: { color: '#9b3b2a', width: 9 }, name: s.label })
    }
    if (s.type === 'arrow3') data.push(...arrow3([s.x, s.y, s.z], '#b9852a', s.label, true))
  }

  const ax = (title: string, range: [number, number] = [-R, R]) => ({ title: { text: title }, range, backgroundcolor: '#e9d6b4', showbackground: true, gridcolor: 'rgba(90,60,30,0.22)', zerolinecolor: 'rgba(60,35,15,0.7)', color: '#5f4128', showspikes: false })
  const layout: Layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    font: FONT,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    showlegend: true,
    legend: { orientation: 'h', x: 0, y: 1, bgcolor: 'rgba(0,0,0,0)' },
    scene: {
      xaxis: ax('x'),
      yaxis: ax('y'),
      zaxis: ax('z', zr),
      aspectmode: 'cube',
      dragmode: 'orbit',
      ...(opts?.revision ? { uirevision: opts.revision } : {}),
      camera: {
        eye: opts?.camera?.eye ?? { x: 1.55, y: 1.35, z: 0.95 },
        ...(opts?.camera?.center ? { center: opts.camera.center } : {}),
        ...(opts?.camera?.up ? { up: opts.camera.up } : {}),
      },
    },
    uirevision: opts?.revision ?? 'keep',
  }
  return { data, layout }
}
