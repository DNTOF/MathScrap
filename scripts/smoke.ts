/**
 * End-to-end math + figure checks against the real WASM build, no browser needed.
 * For every case: parse → analyze (Rust) → build the Plotly figure → assert that each
 * plotted object actually has data inside the initial axis window (no empty axes).
 *
 *   npm run smoke          # assertions only
 *   npm run smoke -- -v    # also print every derived fact
 */
import { readFileSync } from 'node:fs'
import { initSync } from '../src/wasm/pkg/mathcore.js'
import { analyze, type Analysis } from '../src/math/scene'
import { pageGroups } from '../src/math/page'
import { parseCard } from '../src/math/statements'
import { SAMPLES } from '../src/board/samples'
import { buildFigure2d, buildFigure3d, initialRanges, type Ranges } from '../src/plot/figure'
import { cases } from './plot-cases'

initSync({ module: readFileSync(new URL('../src/wasm/pkg/mathcore_bg.wasm', import.meta.url)) })
const verbose = process.argv.includes('-v')

type Trace = Record<string, any>

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * (1 + Math.abs(b))
const inR = (r: Ranges, x: number, y: number) => x >= r.x[0] && x <= r.x[1] && y >= r.y[0] && y <= r.y[1]

/** Problems with a 2D figure: each object must have visible ink inside the window. */
function check2d(a: Analysis, r: Ranges): string[] {
  const out: string[] = []
  const { data, layout } = buildFigure2d(a, r, [])
  if (!(r.x[0] < r.x[1] && r.y[0] < r.y[1]) || ![...r.x, ...r.y].every(Number.isFinite)) out.push(`bad ranges ${JSON.stringify(r)}`)
  const visiblePts = (t: Trace) => (t.x as (number | null)[]).filter((x, i) => x != null && t.y[i] != null && inR(r, x, t.y[i])).length
  for (const o of a.objects) {
    if (o.type === 'curve') {
      const t = data.find((d) => d.name === `${o.name}(x)`)
      const n = t ? visiblePts(t) : 0
      if (n < 40) out.push(`curve ${o.name}(x) has only ${n} visible samples`)
    } else if (o.type === 'implicit2') {
      const t = data.find((d) => d.type === 'contour' && d.name === o.name)
      if (!t) out.push(`no contour for ${o.name}`)
      else {
        let pos = 0
        let neg = 0
        t.y.forEach((yy: number, j: number) => {
          if (yy < r.y[0] || yy > r.y[1]) return
          t.x.forEach((xx: number, i: number) => {
            if (xx < r.x[0] || xx > r.x[1]) return
            const v = t.z[j][i]
            if (v == null) return
            if (v > 0) pos++
            else if (v < 0) neg++
          })
        })
        if (!pos || !neg) out.push(`implicit ${o.name}: zero level not crossed inside the window (pos ${pos}, neg ${neg})`)
      }
    } else if (o.type === 'roots') {
      const t = data.find((d) => d.name === o.name)
      if (o.xs.length && (!t || visiblePts(t) !== o.xs.length)) out.push(`roots not all visible (${o.xs.join(', ')})`)
    } else if (o.type === 'triangle' || o.type === 'points') {
      const verts = o.type === 'triangle' ? o.verts : o.pts.map((p) => p.p)
      const hidden = verts.filter(([x, y]) => !inR(r, x, y))
      if (hidden.length) out.push(`${o.type} vertices outside window: ${JSON.stringify(hidden)}`)
    } else if (o.type === 'vector') {
      if (!inR(r, o.v[0], o.v[1] ?? 0)) out.push(`vector ${o.name} tip outside window`)
      if (!(layout.annotations as unknown[]).length) out.push('vector arrows missing')
    } else if (o.type === 'marks') {
      const hidden = o.pts.filter((p) => !inR(r, p.p[0], p.p[1]))
      if (hidden.length === o.pts.length) out.push('all intersection marks outside window')
    } else if (o.type === 'param') {
      const t = data.find((d) => d.name === `${o.name}(t)`)
      if (!t || visiblePts(t) < 20) out.push(`param curve ${o.name} not visible`)
    }
  }
  return out
}

function check3d(a: Analysis): string[] {
  const out: string[] = []
  const { data, layout } = buildFigure3d(a, [])
  const scene = layout.scene as Record<string, { range: [number, number] }>
  const [z0, z1] = scene.zaxis.range
  const [x0, x1] = scene.xaxis.range
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  for (const o of a.objects) {
    if (o.type === 'surface') {
      const t = data.find((d) => d.type === 'surface' && String(d.name).includes(o.name))
      const zs: unknown[] = t ? (t.z as unknown[][]).flat() : []
      const vis = zs.filter((v) => finite(v) && (v as number) >= z0 && (v as number) <= z1).length
      if (vis < zs.length * 0.6) out.push(`surface ${o.name}: only ${vis}/${zs.length} samples inside z-range [${z0.toFixed(2)}, ${z1.toFixed(2)}]`)
    } else if (o.type === 'plane') {
      const t = data.find((d) => d.type === 'mesh3d' && String(d.name).includes(o.name))
      if (!t || (t.x as number[]).length < 3) out.push(`plane ${o.name} has no polygon inside the cube`)
    } else if (o.type === 'implicit3') {
      const t = data.find((d) => d.type === 'isosurface')
      const v = (t?.value ?? []) as number[]
      if (!v.some((x) => x < 0) || !v.some((x) => x > 0)) out.push(`implicit surface ${o.name}: no sign change in the volume`)
    } else if (o.type === 'param') {
      const t = data.find((d) => d.type === 'scatter3d' && d.name === `${o.name}(t)`)
      if (!t || (t.x as number[]).filter(finite).length < 50) out.push(`param curve ${o.name} not drawn`)
    } else if (o.type === 'vector') {
      if (!data.some((d) => d.type === 'cone')) out.push('vector cones missing')
    } else if (o.type === 'points') {
      const hidden = o.pts.filter((p) => p.p.some((c) => c < x0 || c > x1))
      if (hidden.length) out.push(`points outside the cube: ${hidden.map((p) => p.name).join(', ')}`)
    }
  }
  if (!data.length) out.push('3D figure has no traces')
  return out
}

let failed = 0
for (const [title, text, ex] of cases) {
  const problems: string[] = []
  const kinds = parseCard(text).map((s) => s.kind)
  const a = analyze([{ id: '1', text }])
  if (ex.error) {
    if (!a.errors.some((e) => ex.error!.test(e.message))) problems.push(`expected error ${ex.error}, got ${JSON.stringify(a.errors)} kinds ${kinds}`)
  } else {
    if (a.errors.length) problems.push(`errors: ${a.errors.map((e) => `${e.src}: ${e.message}`).join(' | ')}`)
    if (ex.kinds && JSON.stringify(kinds) !== JSON.stringify(ex.kinds)) problems.push(`kinds ${kinds.join(',')} ≠ ${ex.kinds.join(',')}`)
    if (ex.dim && a.dim !== ex.dim) problems.push(`dim ${a.dim} ≠ ${ex.dim}`)
    if (!a.objects.length) problems.push('nothing to plot')
    const factText = a.sections.flatMap((s) => s.facts.map((f) => `${f.label}=${f.value}`))
    for (const f of ex.facts ?? []) if (!factText.some((t) => t.replace(/\s+/g, ' ').includes(f))) problems.push(`missing fact containing "${f}"`)
    if (ex.minFacts && a.factCount < ex.minFacts) problems.push(`only ${a.factCount} facts`)
    if (ex.solve) {
      if (!a.solve?.solutions.length) problems.push('no solution for unknowns')
      else
        for (const [k, v] of Object.entries(ex.solve)) {
          const ok = a.solve.solutions.some((sol) => near(sol[a.solve!.unknowns.indexOf(k)], v, 1e-5))
          if (!ok) problems.push(`${k} ≠ ${v} (solutions ${JSON.stringify(a.solve.solutions)})`)
        }
    }
    if (ex.roots) {
      const r = a.objects.find((o) => o.type === 'roots')
      const xs = r && r.type === 'roots' ? [...r.xs].sort((p, q) => p - q) : []
      if (xs.length !== ex.roots.length || !ex.roots.every((v, i) => near(xs[i], v, 1e-6))) problems.push(`roots ${JSON.stringify(xs)} ≠ ${JSON.stringify(ex.roots)}`)
    }
    if (a.dim === 2) {
      const r = initialRanges(a)
      problems.push(...check2d(a, r))
      for (const [x, y] of ex.inView ?? []) if (!inR(r, x, y)) problems.push(`(${x}, ${y}) outside window ${JSON.stringify(r)}`)
    } else problems.push(...check3d(a))
  }
  if (problems.length) failed++
  console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${title.padEnd(18)} ${text.replace(/\n/g, ' | ')}`)
  problems.forEach((p) => console.log(`        ✗ ${p}`))
  if (verbose) for (const s of a.sections) console.log(`        # ${s.title}: ${s.facts.map((f) => `${f.label}=${f.value}`).join(' ; ')}`)
}
// ---- one sheet, one coordinate system: formulas written separately share the axes ----
interface PageCase {
  title: string
  blocks: string[]
  expect: Partial<Record<2 | 3, { formulas: number; objects?: string[]; facts?: string[]; solve?: Record<string, number> }>>
}
const pages: PageCase[] = [
  {
    title: '四个平面式子叠在一起',
    blocks: ['y = x^2 - 2', 'y = 0.5x + 1', 'x^2 + y^2 = 4', 'x^2 + 2x + 1 = 0'],
    expect: { 2: { formulas: 4, objects: ['curve', 'curve', 'curve', 'implicit2', 'roots'], facts: ['P_{2}=\\left(2,\\2\\right)', 'P_{2}=\\left(0,\\-2\\right)'] } },
  },
  {
    title: '平面 + 空间混写',
    blocks: ['y = sin(x)', 'z = x^2 + y^2', 'A(0,0), B(4,0), C(1,t)', 'AC ⊥ BC', '𝐚 = (1, 2, 2); 𝐛 = (2, 1, k)', '𝐚 ⊥ 𝐛'],
    expect: { 2: { formulas: 2, objects: ['curve'], solve: { t: Math.sqrt(3) } }, 3: { formulas: 2, objects: ['surface'], solve: { k: -2 } } },
  },
  ...SAMPLES.map((s) => ({ title: `示例 · ${s.title}`, blocks: s.blocks, expect: {} })),
]
let pageFailed = 0
for (const pc of pages) {
  const problems: string[] = []
  const cards = pc.blocks.map((text, i) => ({ id: `c${i}`, text, x: 0, y: i * 60 }))
  const g = pageGroups(cards)
  for (const dim of [2, 3] as const) {
    const ex = pc.expect[dim]
    const entries = g.entries.filter((e) => e.dim === dim)
    if (ex && g.count[dim] !== ex.formulas) problems.push(`${dim}D has ${g.count[dim]} formulas, expected ${ex.formulas}`)
    if (!entries.length) {
      if (ex) problems.push(`no ${dim}D formulas`)
      continue
    }
    const a = analyze(entries.map((e) => ({ id: e.card.id, text: e.card.text })))
    if (a.dim !== dim) problems.push(`${dim}D group analysed as ${a.dim}D`)
    if (a.errors.length) problems.push(`errors ${JSON.stringify(a.errors)}`)
    const types = a.objects.map((o) => o.type)
    for (const t of ex?.objects ?? []) {
      const need = ex!.objects!.filter((x) => x === t).length
      if (types.filter((x) => x === t).length < need) problems.push(`${dim}D: expected ${need}× ${t}, got ${types}`)
    }
    const factText = a.sections.flatMap((s) => s.facts.map((f) => `${f.label}=${f.value}`))
    for (const f of ex?.facts ?? []) if (!factText.some((t) => t.replace(/\s+/g, '').includes(f))) problems.push(`${dim}D: missing fact "${f}"`)
    for (const [k, v] of Object.entries(ex?.solve ?? {})) {
      const ok = a.solve?.solutions.some((sol) => near(Math.abs(sol[a.solve!.unknowns.indexOf(k)]), Math.abs(v), 1e-5))
      if (!ok) problems.push(`${dim}D: ${k} ≠ ${v}`)
    }
    problems.push(...(dim === 2 ? check2d(a, initialRanges(a)) : check3d(a)).map((p) => `${dim}D: ${p}`))
  }
  if (problems.length) pageFailed++
  console.log(`${problems.length ? 'FAIL' : 'ok  '}  [sheet] ${pc.title.padEnd(16)} 2D×${g.count[2]} 3D×${g.count[3]}`)
  problems.forEach((p) => console.log(`        ✗ ${p}`))
}
console.log(`\n${cases.length - failed}/${cases.length} formula cases · ${pages.length - pageFailed}/${pages.length} shared-sheet cases passed`)
process.exit(failed + pageFailed ? 1 : 0)
