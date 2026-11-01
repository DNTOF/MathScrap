import { engine, getStats, resetStats, type Env, type RustFact } from '@/wasm/engine'
import { kindLabel, parseCard, statementLatex, triKeyLatex, type Ref, type Statement } from './statements'

export const INK = ['#2f4a6d', '#9b3b2a', '#4d6b3c', '#8a5a1f', '#5b3f6e', '#2e6f6a', '#7a2f4f']

export const RANGE = 20

export interface CardInput {
  id: string
  text: string
}

export type PlotObj =
  | { type: 'curve'; name: string; expr: string; color: string }
  | { type: 'implicit2'; name: string; F: string; color: string }
  | { type: 'roots'; name: string; xs: number[] }
  | { type: 'surface'; name: string; expr: string; color: string }
  | { type: 'plane'; name: string; n: number[]; d: number; color: string }
  | { type: 'implicit3'; name: string; F: string; color: string }
  | { type: 'points'; pts: { name: string; p: number[] }[]; polygon: boolean; color: string }
  | { type: 'triangle'; verts: [number, number][]; names: string; color: string; dashed: boolean }
  | { type: 'vector'; name: string; v: number[]; color: string }
  | { type: 'param'; name: string; comps: string[]; color: string }
  | { type: 'marks'; pts: { p: number[]; label: string }[] }
  | { type: 'circle'; name: string; cx: number; cy: number; r: number; color: string }
  | { type: 'circleCase'; center: [number, number]; pName: string; p: [number, number]; lines: { a: [number, number]; b: [number, number]; names: [string, string] }[]; color: string; dashed: boolean }

export interface FactSection {
  id: string
  title: string
  subtitle?: string
  tone: 'solve' | 'geo' | 'func' | 'vec' | 'inter' | 'warn'
  facts: RustFact[]
}

export interface SolvedUnknowns {
  unknowns: string[]
  solutions: number[][]
  index: number
  exact: boolean
  conditions: string[]
  note: string
}

export interface Analysis {
  dim: 2 | 3
  dimReason: string
  givens: { latex: string; kind: string; cardId: string }[]
  errors: { src: string; message: string }[]
  solve: SolvedUnknowns | null
  env: Env
  sections: FactSection[]
  factCount: number
  objects: PlotObj[]
  equalAspect: boolean
  stats: { calls: number; ms: number }
}

interface Item {
  st: Statement
  cardId: string
  idx: number
}

const sub = (src: string, name: string, w: string) => engine.substitute(src, name, `(${w})`)

function freeVars(src: string): string[] {
  const r = engine.inspect(src)
  return r.ok ? r.vars : []
}

function isCurveLike(s: Statement) {
  return s.kind === 'curve' || s.kind === 'implicit2' || s.kind === 'surface' || s.kind === 'implicit3'
}

function angleValueSrc(v: string) {
  return /°|pi|π/.test(v) ? v : `(${v})°`
}

/**
 * Build a full analysis for the given cards. `primary` is the card the user opened;
 * `solutionIndex` picks among multiple solutions of the unknowns.
 */
export function analyze(cards: CardInput[], solutionIndex = 0): Analysis {
  resetStats()
  const items: Item[] = []
  cards.forEach((c) => parseCard(c.text).forEach((st) => items.push({ st, cardId: c.id, idx: items.length })))

  const errors = items.filter((i) => i.st.kind === 'error').map((i) => ({ src: i.st.src, message: (i.st as { message: string }).message }))
  const good = items.filter((i) => i.st.kind !== 'error')
  const givens = good.map((i) => ({ latex: statementLatex(i.st), kind: kindLabel(i.st), cardId: i.cardId }))

  // ---- names ---------------------------------------------------------------
  const names = new Map<Item, string>()
  const used = new Set<string>()
  good.forEach((i) => {
    const n = (i.st as { name?: string }).name
    if (n) used.add(n)
  })
  const nextName = (pool: string[], fallback: (k: number) => string) => {
    for (const p of pool) if (!used.has(p)) {
      used.add(p)
      return p
    }
    let k = 1
    while (used.has(fallback(k))) k++
    used.add(fallback(k))
    return fallback(k)
  }
  let anon = 0
  for (const i of good) {
    const st = i.st
    if (st.kind === 'point') names.set(i, st.name || `P_${++anon}`)
    else if (st.kind === 'curve') names.set(i, st.name ?? nextName(['f', 'g', 'h', 'u', 'w'], (k) => `f_${k}`))
    else if (st.kind === 'equation1') names.set(i, nextName(['f', 'g', 'h', 'u', 'w'], (k) => `f_${k}`))
    else if (st.kind === 'surface') names.set(i, st.name ?? nextName(['S'], (k) => `S_${k}`))
    else if ('name' in st && st.name) names.set(i, st.name)
  }

  // ---- symbol tables ---------------------------------------------------------
  const points = new Map<string, string[]>()
  const vectors = new Map<string, string[]>()
  const funcs = new Map<string, string>()
  for (const i of good) {
    if (i.st.kind === 'point') points.set(names.get(i)!, i.st.coords)
    if (i.st.kind === 'vector') vectors.set(i.st.name, i.st.comps)
    if (i.st.kind === 'curve') funcs.set(names.get(i)!, i.st.expr)
  }

  // ---- derived points & vectors (中点 / 分点 / 投影 / 向量和差) --------------------------------
  // They become ordinary entries of the same symbol tables, so every downstream
  // analyzer (constraints, circles, lines, vectors) sees them like any written point.
  const derivedPointNames = new Set<string>()
  const pointDefs: { name: string; a: string; b: string; m: number | null; n: number | null }[] = []
  for (const i of good) {
    if (i.st.kind !== 'pointDef') continue
    const st = i.st
    const A = points.get(st.a)
    const B = points.get(st.b)
    if (!A || !B) {
      errors.push({ src: st.src, message: `先写出 ${!A ? st.a : st.b} 的坐标，再定义 ${st.name}` })
      continue
    }
    if (points.has(st.name)) {
      errors.push({ src: st.src, message: `点 ${st.name} 已经定义过了` })
      continue
    }
    const dim = Math.max(A.length, B.length)
    if (st.m == null && st.n == null) {
      points.set(st.name, Array.from({ length: dim }, (_, t) => `((${A[t] ?? '0'}) + (${B[t] ?? '0'}))/2`))
      pointDefs.push({ name: st.name, a: st.a, b: st.b, m: null, n: null })
    } else {
      const m = st.m != null ? Number(st.m) : 1
      const n = st.n != null ? Number(st.n) : 1
      if (![m, n].every(Number.isFinite) || m + n === 0 || m < 0 || n < 0) {
        errors.push({ src: st.src, message: '分点的比要是正数，例如 1:2' })
        continue
      }
      points.set(st.name, Array.from({ length: dim }, (_, t) => `((${fmt(m)})*(${A[t] ?? '0'}) + (${fmt(n)})*(${B[t] ?? '0'}))/(${fmt(m + n)})`))
      pointDefs.push({ name: st.name, a: st.a, b: st.b, m: st.m != null ? m : null, n: st.n != null ? n : null })
    }
    derivedPointNames.add(st.name)
  }
  for (const i of good) {
    if (i.st.kind !== 'vectorDef') continue
    const st = i.st
    const A = vectors.get(st.a)
    const B = vectors.get(st.b)
    if (!A || !B) {
      errors.push({ src: st.src, message: `先定义向量 ${!A ? st.a : st.b}（粗体名 = (…)），再定义 ${st.name}` })
      continue
    }
    let comps: string[]
    if (st.op === 'proj') {
      const dot = A.map((x, t) => `(${x})*(${B[t] ?? '0'})`).join(' + ')
      const norm2 = B.map((x) => `(${x})^2`).join(' + ')
      comps = A.map((_, t) => `((${dot})/(${norm2}))*(${B[t] ?? '0'})`)
    } else {
      const sign = st.op === 'sum' ? '+' : '-'
      comps = A.map((x, t) => `(${x}) ${sign} (${B[t] ?? '0'})`)
    }
    vectors.set(st.name, comps)
  }

  // ---- unknowns ---------------------------------------------------------------
  const unknownSet = new Set<string>()
  const addVars = (src: string, bound: string[]) => freeVars(src).forEach((v) => !bound.includes(v) && unknownSet.add(v))
  for (const { st } of good) {
    switch (st.kind) {
      case 'curve':
        addVars(st.expr, ['x'])
        break
      case 'implicit2':
        addVars(st.F, ['x', 'y'])
        break
      case 'equation1':
        addVars(st.F, ['x'])
        break
      case 'surface':
        addVars(st.expr, ['x', 'y'])
        break
      case 'implicit3':
        addVars(st.F, ['x', 'y', 'z'])
        break
      case 'param':
        st.comps.forEach((c) => addVars(c, ['t']))
        break
      case 'point':
        st.coords.forEach((c) => addVars(c, []))
        break
      case 'vector':
        st.comps.forEach((c) => addVars(c, []))
        break
      case 'constraint': {
        const c = st.c
        if (c.type === 'len' || c.type === 'angle') addVars(c.value, [])
        if (c.type === 'fcall') {
          addVars(c.arg, [])
          addVars(c.value, [])
        }
        if (c.type === 'through' && c.coords) c.coords.forEach((x) => addVars(x, []))
        if (c.type === 'equation') addVars(c.F, [])
        break
      }
      default:
        break
    }
  }
  const unknowns = [...unknownSet]

  // ---- residual equations from constraints -------------------------------------
  const residuals: string[] = []
  const conditions: string[] = []
  const constraintErrors: { src: string; message: string }[] = []
  const refComps = (r: Ref): string[] | null => {
    if (r.kind === 'vec') return vectors.get(r.name) ?? null
    const P = points.get(r.p)
    const Q = points.get(r.q)
    if (!P || !Q) return null
    const dim = Math.max(P.length, Q.length)
    return Array.from({ length: dim }, (_, k) => `(${Q[k] ?? '0'}) - (${P[k] ?? '0'})`)
  }
  const dot = (u: string[], v: string[]) => u.map((a, k) => `(${a})*(${v[k] ?? '0'})`).join(' + ')
  const norm2 = (u: string[]) => u.map((a) => `(${a})^2`).join(' + ')

  good.forEach((item, pos) => {
    const st = item.st
    if (st.kind !== 'constraint') return
    const c = st.c
    const before = residuals.length
    const fail = (message: string) => constraintErrors.push({ src: st.src, message })
    switch (c.type) {
      case 'perp':
      case 'para': {
        const u = refComps(c.a)
        const v = refComps(c.b)
        if (!u || !v) return fail('找不到相关的点或向量，请先写出它们')
        if (c.type === 'perp') residuals.push(dot(u, v))
        else if (Math.max(u.length, v.length) === 2) residuals.push(`(${u[0]})*(${v[1] ?? '0'}) - (${u[1]})*(${v[0]})`)
        else {
          const [a1, a2, a3] = [u[0], u[1], u[2] ?? '0']
          const [b1, b2, b3] = [v[0], v[1], v[2] ?? '0']
          residuals.push(`(${a2})*(${b3}) - (${a3})*(${b2})`, `(${a3})*(${b1}) - (${a1})*(${b3})`, `(${a1})*(${b2}) - (${a2})*(${b1})`)
        }
        break
      }
      case 'len': {
        const u = refComps(c.ref)
        if (!u) return fail('找不到相关的点或向量')
        residuals.push(`${norm2(u)} - (${c.value})^2`)
        break
      }
      case 'angle': {
        const P = points.get(c.p)
        const Q = points.get(c.q)
        const R = points.get(c.r)
        if (!P || !Q || !R) return fail('∠ 需要先定义三个点')
        const u = P.map((p, k) => `(${p}) - (${Q[k] ?? '0'})`)
        const v = R.map((r, k) => `(${r}) - (${Q[k] ?? '0'})`)
        residuals.push(`${dot(u, v)} - sqrt(${norm2(u)})*sqrt(${norm2(v)})*cos(${angleValueSrc(c.value)})`)
        break
      }
      case 'through': {
        const coords = c.coords ?? (c.point ? points.get(c.point) : null)
        if (!coords) return fail('找不到这个点')
        let target: Item | undefined
        for (let k = pos - 1; k >= 0; k--) {
          if (good[k].cardId === item.cardId && isCurveLike(good[k].st)) {
            target = good[k]
            break
          }
        }
        target ??= good.find((g) => isCurveLike(g.st))
        if (!target) return fail('“过某点”需要先写出一条曲线，例如 y = kx + b')
        const t = target.st
        const [p, q, r] = coords
        if (t.kind === 'curve') residuals.push(`(${sub(t.expr, 'x', p)}) - (${q})`)
        else if (t.kind === 'implicit2') residuals.push(sub(sub(t.F, 'x', p), 'y', q ?? '0'))
        else if (t.kind === 'surface') residuals.push(`(${sub(sub(t.expr, 'x', p), 'y', q ?? '0')}) - (${r ?? '0'})`)
        else if (t.kind === 'implicit3') residuals.push(sub(sub(sub(t.F, 'x', p), 'y', q ?? '0'), 'z', r ?? '0'))
        break
      }
      case 'fcall': {
        const e = funcs.get(c.fname)
        if (!e) return fail(`还没有定义函数 ${c.fname}(x)`)
        if (c.deriv) {
          const h = '0.000001'
          residuals.push(`((${sub(e, 'x', `(${c.arg})+${h}`)}) - (${sub(e, 'x', `(${c.arg})-${h}`)}))/(2*${h}) - (${c.value})`)
        } else residuals.push(`(${sub(e, 'x', c.arg)}) - (${c.value})`)
        break
      }
      case 'equation':
        residuals.push(c.F)
        break
    }
    if (residuals.length > before) conditions.push(statementLatex(st))
  })
  errors.push(...constraintErrors)

  // ---- solve --------------------------------------------------------------------
  let env: Env = {}
  let solve: SolvedUnknowns | null = null
  const sections: FactSection[] = []
  if (unknowns.length) {
    if (!residuals.length) {
      unknowns.forEach((u) => (env[u] = 1))
      solve = { unknowns, solutions: [], index: 0, exact: false, conditions, note: `含未知量 ${unknowns.join(', ')}，但还没有条件。暂按 ${unknowns.map((u) => `${u}=1`).join(', ')} 绘图——试着加上「过(1, 3)」或「AB ⊥ BC」。` }
    } else {
      const r = engine.solveSystem(residuals, unknowns)
      const negatives = (s: number[]) => s.filter((v) => v < 0).length
      const sols = [...r.solutions].sort((a, b) => negatives(a) - negatives(b))
      const index = Math.min(solutionIndex, Math.max(0, sols.length - 1))
      if (sols.length) unknowns.forEach((u, k) => (env[u] = sols[index][k]))
      else unknowns.forEach((u) => (env[u] = 1))
      const missing = unknowns.length - residuals.length
      let note = ''
      if (r.error) note = `条件里有无法解析的内容：${r.error}`
      else if (!sols.length) note = '没有找到满足所有条件的解。'
      else if (!r.exact) note = '这些条件不能同时精确满足，下面是误差最小的近似解（请检查条件是否矛盾）。'
      else if (missing > 0) note = `条件比未知量少 ${missing} 个，解不唯一；这里展示其中一组。`
      else if (sols.length > 1) note = `共有 ${sols.length} 组解，可在上方切换。`
      solve = { unknowns, solutions: sols, index, exact: r.exact, conditions, note }
      const how = conditions.length ? `\\begin{cases} ${conditions.join(' \\\\ ')} \\end{cases}` : ''
      sections.push({
        id: 'solve',
        title: '解出未知量',
        subtitle: `联立 ${residuals.length} 个方程 · Rust 多起点 LM 求解`,
        tone: sols.length && r.exact ? 'solve' : 'warn',
        facts: sols.length
          ? unknowns.map((u, k) => ({ group: '未知量', label: engine.latex(u), value: engine.nice(sols[index][k]), num: sols[index][k], how, why: sols.length > 1 ? `第 ${index + 1} / ${sols.length} 组解` : '唯一解', shape: null }))
          : [{ group: '未知量', label: unknowns.join(','), value: '\\text{无解}', num: null, how, why: '条件矛盾或超出搜索范围', shape: null }],
      })
    }
  }

  const num = (src: string) => engine.eval(src, env)
  const objects: PlotObj[] = []
  let color = 0
  const nextColor = () => INK[color++ % INK.length]

  // ---- triangles -------------------------------------------------------------------
  let equalAspect = false
  for (const i of good) {
    if (i.st.kind !== 'triangle') continue
    equalAspect = true
    const st = i.st
    const known: Record<string, number> = {}
    for (const [k, v] of Object.entries(st.known)) {
      known[k] = /[ABC]/.test(k) ? num(angleValueSrc(v)) : num(v)
    }
    const res = engine.triangle(known)
    const givenFacts: RustFact[] = Object.entries(st.known).map(([k, v]) => ({
      group: '已知',
      label: triKeyLatex(k, st.names),
      value: /[ABC]/.test(k) ? engine.latex(angleValueSrc(v)) : engine.latex(v),
      num: known[k],
      how: '',
      why: '题目给出',
      shape: null,
    }))
    if (res.error) {
      sections.push({ id: `tri-${i.idx}`, title: `△${st.names}`, subtitle: '解三角形', tone: 'warn', facts: [...givenFacts, { group: '无法求解', label: '\\text{提示}', value: `\\text{${res.error}}`, num: null, how: '', why: '', shape: null }] })
      continue
    }
    const renamed = (f: RustFact) => ({ ...f, label: renameTri(f.label, st.names), how: renameTri(f.how, st.names) })
    res.cases.forEach((cs, k) => {
      sections.push({
        id: `tri-${i.idx}-${k}`,
        title: `△${st.names}${res.cases.length > 1 ? ` · 第 ${k + 1} 解` : ''}`,
        subtitle: cs.note,
        tone: 'geo',
        facts: [...(k === 0 ? givenFacts : []), ...cs.facts.map(renamed)],
      })
      objects.push({ type: 'triangle', verts: cs.vertices, names: st.names, color: nextColor(), dashed: k > 0 })
    })
  }

  // ---- points ------------------------------------------------------------------------
  const numPoints: { name: string; p: number[] }[] = []
  for (const [name, coords] of points) {
    const p = coords.map(num)
    if (p.every(Number.isFinite)) numPoints.push({ name, p })
    else errors.push({ src: name, message: `点 ${name} 的坐标无法求值` })
  }
  const basePts = numPoints.filter((p) => !derivedPointNames.has(p.name))
  const derivedPts = numPoints.filter((p) => derivedPointNames.has(p.name))
  const pts2 = numPoints.filter((p) => p.p.length === 2)
  const pts3 = numPoints.filter((p) => p.p.length === 3)
  if (basePts.length) {
    equalAspect = true
    const group = basePts.some((p) => p.p.length === 3) ? basePts.filter((p) => p.p.length === 3) : basePts.filter((p) => p.p.length === 2)
    const facts = engine.points(group)
    if (facts.length) {
      const title = group.length >= 3 ? `${group.length === 3 ? '△' : group.length === 4 ? '四边形 ' : '多边形 '}${group.map((p) => p.name).join('')}` : `点 ${group.map((p) => p.name).join(', ')}`
      sections.push({ id: 'points', title, subtitle: group[0].p.length === 3 ? '空间坐标几何' : '坐标几何', tone: 'geo', facts })
    }
    objects.push({ type: 'points', pts: group, polygon: group.length >= 3, color: '#3b2a1a' })
  }
  if (derivedPts.length) {
    const facts = engine.derivedPoints(pointDefs, numPoints)
    if (facts.length) sections.push({ id: 'point-defs', title: '中点与分点', subtitle: '定比分点 · 中位线', tone: 'geo', facts })
    objects.push({ type: 'points', pts: derivedPts, polygon: false, color: '#3b2a1a' })
  }

  // ---- explicit circles (⊙O: r = 5) and their chord problems ---------------------------
  const sheetCircles = new Map<Item, { name: string; cx: number; cy: number; r: number }>()
  for (const i of good) {
    if (i.st.kind !== 'circle') continue
    const st = i.st
    const ctr = st.center ? points.get(st.center) : null
    const cx = ctr ? num(ctr[0] ?? '0') : 0
    const cy = ctr ? num(ctr[1] ?? '0') : 0
    let r = st.radius ? num(st.radius) : NaN
    if (!Number.isFinite(r)) {
      for (const th of st.through) {
        const q = th.coords ? th.coords.map(num) : th.point ? (points.get(th.point) ?? []).map(num) : null
        if (q?.length && q.every(Number.isFinite)) {
          r = Math.hypot(q[0] - cx, (q[1] ?? 0) - cy)
          break
        }
      }
    }
    if (Number.isFinite(r) && r > 0) {
      sheetCircles.set(i, { name: st.name, cx, cy, r })
      equalAspect = true
      objects.push({ type: 'circle', name: st.name, cx, cy, r, color: nextColor() })
    } else {
      errors.push({ src: st.src, message: '这个圆缺少半径：写 ⊙O: r = 5，或 ⊙O: 过(3, 4)' })
    }
  }
  const chordName = (st: Extract<Statement, { kind: 'chords' }>) =>
    st.chords[0].length === 1 ? `切线 ${st.p}${st.chords[0][0]}、割线 ${st.p}${st.chords[1].join('')}` : `弦 ${st.chords[0].join('')}、${st.chords[1].join('')}`
  good.forEach((item, pos) => {
    if (item.st.kind !== 'chords') return
    const st = item.st
    let target: Item | undefined
    for (let k = pos - 1; k >= 0; k--) {
      if (good[k].cardId === item.cardId && good[k].st.kind === 'circle') {
        target = good[k]
        break
      }
    }
    target ??= [...good.slice(0, pos)].reverse().find((g) => g.st.kind === 'circle')
    const cir = target ? sheetCircles.get(target) : undefined
    if (!cir) {
      errors.push({ src: st.src, message: '先写一个圆（例如 ⊙O: r = 5），弦的条件才有依托' })
      return
    }
    const lengths: Record<string, number> = {}
    for (const [k, v] of Object.entries(st.lengths)) lengths[k] = num(v)
    if (!Object.values(lengths).every(Number.isFinite)) {
      errors.push({ src: st.src, message: '线段长度无法求值' })
      return
    }
    const res = engine.circle({ r: cir.r, cross: { p: st.p, chords: st.chords, lengths, pos: st.pos } })
    const givenFacts: RustFact[] = [
      { group: '已知', label: `r_{${cir.name}}`, value: engine.nice(cir.r), num: cir.r, how: '', why: `⊙${cir.name} 的半径`, shape: null },
      ...Object.entries(st.lengths).map(([k, v]) => ({ group: '已知', label: engine.latex(k), value: engine.latex(v), num: lengths[k], how: '', why: '题目给出', shape: null })),
    ]
    if (res.error) {
      sections.push({ id: `chords-${item.idx}`, title: `⊙${cir.name} · ${chordName(st)}`, subtitle: '圆中的弦', tone: 'warn', facts: [...givenFacts, { group: '无法求解', label: '\\text{提示}', value: `\\text{${res.error}}`, num: null, how: '', why: '', shape: null }] })
      return
    }
    equalAspect = true
    res.cases.forEach((cs, k) => {
      sections.push({
        id: `chords-${item.idx}-${k}`,
        title: `⊙${cir.name} · ${chordName(st)}${res.cases.length > 1 ? ` · 第 ${k + 1} 解` : ''}`,
        subtitle: cs.note,
        tone: 'geo',
        facts: [...(k === 0 ? givenFacts : []), ...cs.facts],
      })
      // the canonical picture centres on (0,0); slide it onto this circle
      const dx = cir.cx - cs.center[0]
      const dy = cir.cy - cs.center[1]
      objects.push({
        type: 'circleCase',
        center: [cir.cx, cir.cy],
        pName: st.p,
        p: [cs.p[0] + dx, cs.p[1] + dy],
        lines: cs.lines.map((L) => ({ a: [L.a[0] + dx, L.a[1] + dy] as [number, number], b: [L.b[0] + dx, L.b[1] + dy] as [number, number], names: L.names })),
        color: nextColor(),
        dashed: k > 0,
      })
    })
  })

  // ---- curves: classify lines / conics / general functions -----------------------------
  type Curve = { item: Item; name: string; kind: 'curve' | 'implicit2'; src: string; line?: { a: number; b: number; c: number }; equation?: boolean }
  const curves: Curve[] = []
  const detectedCircles: { name: string; cx: number; cy: number; r: number }[] = []
  for (const i of good) {
    if (i.st.kind === 'equation1') {
      curves.push({ item: i, name: names.get(i)!, kind: 'curve', src: i.st.F, equation: true })
    } else if (i.st.kind === 'curve') {
      const co = engine.linearCoeffs(i.st.expr, ['x'], env)
      const name = names.get(i)!
      const c: Curve = { item: i, name, kind: 'curve', src: i.st.expr }
      if (co) c.line = { a: -co[0], b: 1, c: co[1] }
      curves.push(c)
    } else if (i.st.kind === 'implicit2') {
      const co = engine.linearCoeffs(i.st.F, ['x', 'y'], env)
      const isLine = !!co && (co[0] !== 0 || co[1] !== 0)
      const name = i.st.name ?? (isLine ? nextName(['l', 'm', 'n'], (k) => `l_${k}`) : nextName(['C'], (k) => `C_${k}`))
      names.set(i, name)
      const c: Curve = { item: i, name, kind: 'implicit2', src: i.st.F }
      if (isLine && co) c.line = { a: co[0], b: co[1], c: -co[2] }
      curves.push(c)
    }
  }
  curves.forEach((c) => {
    const col = nextColor()
    objects.push(c.kind === 'curve' ? { type: 'curve', name: c.name, expr: c.src, color: col } : { type: 'implicit2', name: c.name, F: c.src, color: col })
  })

  const lines = curves.filter((c) => c.line)
  if (lines.length) {
    const facts = engine.lines(lines.map((l) => ({ name: l.name, ...l.line! })), pts2)
    sections.push({ id: 'lines', title: lines.length > 1 ? `直线 ${lines.map((l) => l.name).join(', ')}` : `直线 ${lines[0].name}`, subtitle: '斜率 · 截距 · 位置关系', tone: 'func', facts })
  }

  for (const c of curves) {
    if (c.equation) {
      const st = c.item.st as Extract<Statement, { kind: 'equation1' }>
      const { facts, roots } = equationFacts(st, c.name, env)
      sections.push({ id: `eq-${c.item.idx}`, title: `方程 ${statementLatex(st)}`, subtitle: `看作 y = ${c.name}(x) 与 x 轴的交点`, tone: 'solve', facts })
      objects.push({ type: 'roots', name: `${c.name}(x) = 0 的解`, xs: roots })
      continue
    }
    if (c.line) continue
    if (c.kind === 'implicit2') {
      const facts = engine.conic(c.src, env, c.name)
      if (facts.length) {
        equalAspect = true
        sections.push({ id: `conic-${c.name}`, title: `曲线 ${c.name}`, subtitle: '圆锥曲线识别（配方 / 特征值）', tone: 'func', facts })
      }
      const cc = engine.circleOf(c.src, env)
      if (cc) detectedCircles.push({ name: c.name, ...cc })
      continue
    }
    const facts: RustFact[] = []
    const gaps = engine.domainGaps(c.src, 'x', env, -RANGE, RANGE)
    if (gaps.length) {
      const parts: string[] = []
      for (let k = 0; k < gaps.length; k += 2) {
        const a = gaps[k]
        const b = gaps[k + 1]
        if (Math.abs(b - a) < 1e-6) parts.push(`x \\ne ${fmt(a)}`)
        else parts.push(`x \\notin (${a <= -RANGE + 1e-6 ? '-\\infty' : fmt(a)},\\ ${b >= RANGE - 1e-6 ? '+\\infty' : fmt(b)})`)
      }
      facts.push({ group: '定义域', label: 'D', value: parts.join(',\\ '), num: null, how: domainHint(c.src), why: '数值扫描定义域', shape: null })
    } else {
      const poles = poleHints(c.src, env)
      facts.push({ group: '定义域', label: 'D', value: poles.length ? poles.map((p) => `x \\ne ${fmt(p)}`).join(',\\ ') : '\\mathbb{R}', num: null, how: domainHint(c.src), why: poles.length ? '分母为 0 处无定义' : '在扫描范围内处处有定义', shape: null })
    }
    const y0 = engine.eval(c.src, { ...env, x: 0 })
    if (Number.isFinite(y0)) facts.push({ group: '截距与零点', label: `${c.name}(0)`, value: engine.nice(y0), num: y0, how: `x = 0`, why: '与 y 轴交点', shape: { type: 'point', x: 0, y: y0, label: `${c.name}(0)` } })
    const zs = engine.roots(c.src, 'x', env, -RANGE, RANGE)
    if (zs.length && zs.length <= 12) zs.forEach((z, k) => facts.push({ group: '截距与零点', label: `x_{${k + 1}}`, value: engine.nice(z), num: z, how: `${c.name}(x) = 0`, why: '零点', shape: { type: 'point', x: z, y: 0, label: `零点 x=${fmt(z)}` } }))
    else if (zs.length > 12) facts.push({ group: '截距与零点', label: '\\text{零点}', value: `\\text{共 ${zs.length} 个（周期性）}`, num: null, how: '', why: `在 [-${RANGE}, ${RANGE}] 内`, shape: null })
    else facts.push({ group: '截距与零点', label: '\\text{零点}', value: '\\text{无}', num: null, how: '', why: `在 [-${RANGE}, ${RANGE}] 内没有实根`, shape: null })
    const ex = engine.extrema(c.src, 'x', env, -RANGE, RANGE)
    if (ex.length && ex.length <= 10)
      ex.forEach((e) => facts.push({ group: '极值', label: e.kind === 'max' ? '\\text{极大值}' : '\\text{极小值}', value: `${c.name}(${fmt(e.x)}) = ${engine.nice(e.y)}`, num: e.y, how: `${c.name}'(x) = 0`, why: '导数变号', shape: { type: 'point', x: e.x, y: e.y, label: e.kind === 'max' ? '极大' : '极小' } }))
    else if (ex.length > 10) facts.push({ group: '极值', label: '\\text{极值}', value: `\\text{共 ${ex.length} 个}`, num: null, how: '', why: '周期性振荡', shape: null })
    for (const p of pts2) {
      const v = engine.eval(c.src, { ...env, x: p.p[0] })
      if (Math.abs(v - p.p[1]) < 1e-7) facts.push({ group: '点与曲线', label: `${p.name} \\in ${c.name}`, value: '\\checkmark', num: null, how: `${c.name}(${fmt(p.p[0])}) = ${fmt(p.p[1])}`, why: '代入成立', shape: null })
    }
    sections.push({ id: `fn-${c.name}`, title: `函数 ${c.name}(x)`, subtitle: '定义域 · 零点 · 极值', tone: 'func', facts })
  }

  // ---- pairwise intersections (skip line-line, handled above) ----------------------------
  const inter: RustFact[] = []
  const marks: { p: number[]; label: string }[] = []
  for (let a = 0; a < curves.length; a++) {
    for (let b = a + 1; b < curves.length; b++) {
      const A = curves[a]
      const B = curves[b]
      if (A.line && B.line) continue
      if (A.equation || B.equation) continue
      let pts: number[] = []
      if (A.kind === 'curve' && B.kind === 'curve') pts = engine.intersectCurves(A.src, B.src, env, -RANGE, RANGE)
      else if (A.kind === 'curve' || B.kind === 'curve') {
        const [f, F] = A.kind === 'curve' ? [A, B] : [B, A]
        pts = engine.intersectCurveImplicit(f.src, F.src, env, -RANGE, RANGE)
      } else {
        const r = engine.solveSystem([A.src, B.src], ['x', 'y'], env)
        if (r.exact) pts = r.solutions.flat()
      }
      const label = `${A.name} \\cap ${B.name}`
      if (!pts.length) {
        inter.push({ group: label, label, value: '\\varnothing', num: null, how: '', why: '没有交点（在搜索范围内）', shape: null })
        continue
      }
      if (pts.length > 24) {
        inter.push({ group: label, label, value: `\\text{${pts.length / 2} 个交点}`, num: null, how: '', why: '交点过多，仅在图上标出', shape: null })
      }
      for (let k = 0; k < pts.length && k < 24; k += 2) {
        const snap = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v)
        const x = snap(pts[k])
        const y = snap(pts[k + 1])
        marks.push({ p: [x, y], label: `${A.name}∩${B.name}` })
        if (pts.length <= 24) inter.push({ group: label, label: `P_{${k / 2 + 1}}`, value: `\\left(${engine.nice(x).split(' ')[0]},\\ ${engine.nice(y).split(' ')[0]}\\right)`, num: null, how: A.kind === 'curve' && B.kind === 'curve' ? `${A.name}(x) = ${B.name}(x)` : '\\text{联立方程}', why: `≈ (${fmt(x)}, ${fmt(y)})`, shape: null })
      }
    }
  }
  if (inter.length) sections.push({ id: 'inter', title: '交点', subtitle: '两两联立 · Rust 求根', tone: 'inter', facts: inter })

  // ---- circles × named points: powers, chords, central / inscribed angles --------------
  const allCircles = [...sheetCircles.values(), ...detectedCircles]
  if ((allCircles.length && pts2.length) || allCircles.length >= 2) {
    const facts = engine.circles(allCircles, pts2)
    if (facts.length) {
      const title = pts2.length ? `圆与点 ${allCircles.map((c) => `⊙${c.name}`).join(' ')}` : `两圆 ${allCircles.map((c) => `⊙${c.name}`).join(' ')}`
      const subtitle = allCircles.length >= 2 ? '点的幂 · 弦 · 根轴' : '点的幂 · 弦 · 圆周角'
      sections.push({ id: 'circle-points', title, subtitle, tone: 'geo', facts })
    }
  }

  // ---- vectors ----------------------------------------------------------------------------
  const numVecs: { name: string; v: number[] }[] = []
  for (const [name, comps] of vectors) {
    const v = comps.map(num)
    if (v.every(Number.isFinite)) numVecs.push({ name, v })
  }
  if (numVecs.length) {
    sections.push({ id: 'vectors', title: `向量 ${numVecs.map((v) => v.name).join(', ')}`, subtitle: '模长 · 夹角 · 数量积 / 向量积', tone: 'vec', facts: engine.vectors(numVecs) })
    numVecs.forEach((v) => objects.push({ type: 'vector', name: v.name, v: v.v, color: nextColor() }))
  }

  // ---- 3D: planes / surfaces / implicit ------------------------------------------------------
  const planes: { name: string; n: number[]; d: number }[] = []
  const spheres: { name: string; c: number[]; r: number }[] = []
  for (const i of good) {
    if (i.st.kind === 'implicit3') {
      const co = engine.linearCoeffs(i.st.F, ['x', 'y', 'z'], env)
      if (co && (co[0] || co[1] || co[2])) {
        const name = i.st.name ?? nextName(['α', 'β', 'γ'], (k) => `π_${k}`)
        planes.push({ name, n: co.slice(0, 3), d: -co[3] })
        objects.push({ type: 'plane', name, n: co.slice(0, 3), d: -co[3], color: nextColor() })
      } else {
        const name = i.st.name ?? nextName(['Σ'], (k) => `Σ_${k}`)
        objects.push({ type: 'implicit3', name, F: i.st.F, color: nextColor() })
        const sph = parseSphere(i.st.F, env)
        if (sph) {
          spheres.push({ name, c: sph.c, r: sph.r })
          sections.push({ id: `sph-${i.idx}`, title: `曲面 ${name}`, subtitle: '球面识别', tone: 'func', facts: sphereFactsFrom(sph) })
        }
      }
    } else if (i.st.kind === 'surface') {
      const name = names.get(i)!
      objects.push({ type: 'surface', name, expr: i.st.expr, color: nextColor() })
      const grid = engine.sampleGrid(i.st.expr, 'x', 'y', env, -5, 5, -5, 5, 81, 81)
      let lo = Infinity
      let hi = -Infinity
      let loAt = [0, 0]
      let hiAt = [0, 0]
      grid.forEach((v, k) => {
        if (!Number.isFinite(v)) return
        const x = -5 + (k % 81) * 0.125
        const y = -5 + Math.floor(k / 81) * 0.125
        if (v < lo) {
          lo = v
          loAt = [x, y]
        }
        if (v > hi) {
          hi = v
          hiAt = [x, y]
        }
      })
      const z0 = engine.eval(i.st.expr, { ...env, x: 0, y: 0 })
      const facts: RustFact[] = []
      if (Number.isFinite(z0)) facts.push({ group: '取值', label: 'z(0,0)', value: engine.nice(z0), num: z0, how: '', why: '原点处的高度', shape: { type: 'point3', x: 0, y: 0, z: z0, label: 'z(0,0)' } })
      if (Number.isFinite(lo)) {
        facts.push({ group: '取值', label: '\\max z', value: `${fmt(hi)}`, num: hi, how: `(x, y) \\approx (${fmt(hiAt[0])}, ${fmt(hiAt[1])})`, why: '在 [-5,5]² 网格上', shape: { type: 'point3', x: hiAt[0], y: hiAt[1], z: hi, label: '最高点' } })
        facts.push({ group: '取值', label: '\\min z', value: `${fmt(lo)}`, num: lo, how: `(x, y) \\approx (${fmt(loAt[0])}, ${fmt(loAt[1])})`, why: '在 [-5,5]² 网格上', shape: { type: 'point3', x: loAt[0], y: loAt[1], z: lo, label: '最低点' } })
      }
      const nanCount = grid.filter((v) => !Number.isFinite(v)).length
      if (nanCount) facts.push({ group: '定义域', label: 'D', value: `\\text{约 ${Math.round((100 * nanCount) / grid.length)}\\% 的网格点无定义}`, num: null, how: domainHint(i.st.expr), why: '数值扫描', shape: null })
      sections.push({ id: `surf-${name}`, title: `曲面 z = ${name}(x, y)`, subtitle: '网格采样 81×81', tone: 'func', facts })
    } else if (i.st.kind === 'param') {
      objects.push({ type: 'param', name: i.st.name, comps: i.st.comps, color: nextColor() })
    }
  }
  if (planes.length) sections.push({ id: 'planes', title: `平面 ${planes.map((p) => p.name).join(', ')}`, subtitle: '法向量 · 夹角 · 交线 / 交点', tone: 'geo', facts: engine.planes(planes, pts3) })

  if (spheres.length && planes.length) {
    const facts: RustFact[] = []
    for (const s of spheres) {
      for (const p of planes) {
        const ln = Math.hypot(p.n[0], p.n[1], p.n[2])
        if (ln < 1e-12) continue
        const signed = (p.n[0] * s.c[0] + p.n[1] * s.c[1] + p.n[2] * s.c[2] - p.d) / ln
        const dist = Math.abs(signed)
        const label = `${s.name} \\cap ${p.name}`
        if (dist > s.r + 1e-9) {
          facts.push({ group: '球面与平面', label, value: '\\varnothing', num: null, how: 'd > r', why: '球心到平面的距离大于半径，不相交', shape: null })
        } else if (Math.abs(dist - s.r) < 1e-9) {
          const t = -signed
          const q = [s.c[0] + (t * p.n[0]) / ln, s.c[1] + (t * p.n[1]) / ln, s.c[2] + (t * p.n[2]) / ln]
          facts.push({
            group: '球面与平面',
            label,
            value: `\\text{相切于 }\\left(${fmt(q[0])},\\ ${fmt(q[1])},\\ ${fmt(q[2])}\\right)`,
            num: 0,
            how: 'd = r',
            why: '球心到平面的距离等于半径',
            shape: { type: 'point3', x: q[0], y: q[1], z: q[2], label: `${s.name}∩${p.name}` },
          })
        } else {
          const rho = Math.sqrt(Math.max(0, s.r * s.r - dist * dist))
          const t = -signed
          const q = [s.c[0] + (t * p.n[0]) / ln, s.c[1] + (t * p.n[1]) / ln, s.c[2] + (t * p.n[2]) / ln]
          facts.push({
            group: '球面与平面',
            label: `\\text{交圆圆心}_{${s.name},${p.name}}`,
            value: `\\left(${fmt(q[0])},\\ ${fmt(q[1])},\\ ${fmt(q[2])}\\right)`,
            num: null,
            how: "O' = O - \\dfrac{ax_0+by_0+cz_0-d}{|n|^2}\\vec n",
            why: '球心在平面上的投影',
            shape: { type: 'point3', x: q[0], y: q[1], z: q[2], label: '交圆圆心' },
          })
          facts.push({
            group: '球面与平面',
            label: `\\rho_{${s.name}\\cap ${p.name}}`,
            value: engine.nice(rho),
            num: rho,
            how: '\\rho = \\sqrt{r^2 - d^2}',
            why: '交圆半径',
            shape: null,
          })
          facts.push({
            group: '球面与平面',
            label,
            value: '\\text{圆}',
            num: rho,
            how: 'd < r',
            why: '球面被平面截得一圆',
            shape: null,
          })
        }
      }
    }
    if (facts.length) sections.push({ id: 'sphere-plane', title: '球面 ∩ 平面', subtitle: '交圆 · 相切 · 相离', tone: 'geo', facts })
  }


  if (spheres.length >= 2) {
    const facts: RustFact[] = []
    for (let i = 0; i < spheres.length; i++) {
      for (let j = i + 1; j < spheres.length; j++) {
        const A = spheres[i]
        const B = spheres[j]
        const n = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]]
        const ln = Math.hypot(n[0], n[1], n[2])
        const d =
          (B.c[0] ** 2 + B.c[1] ** 2 + B.c[2] ** 2 - A.c[0] ** 2 - A.c[1] ** 2 - A.c[2] ** 2 - B.r ** 2 + A.r ** 2) / 2
        if (ln < 1e-12) {
          facts.push({
            group: '根面',
            label: `${A.name}, ${B.name}`,
            value: Math.abs(A.r - B.r) < 1e-9 ? '\\text{同心等半径（重合）}' : '\\text{同心不等半径（无根面）}',
            num: null,
            how: '\\vec{O_1O_2} = \\mathbf{0}',
            why: '两球球心重合',
            shape: null,
          })
          continue
        }
        const terms: string[] = []
        ;(['x', 'y', 'z'] as const).forEach((ax, k) => {
          if (Math.abs(n[k]) < 1e-12) return
          const coef = Math.abs(n[k] - 1) < 1e-9 ? '' : Math.abs(n[k] + 1) < 1e-9 ? '-' : fmt(n[k])
          terms.push(`${coef}${ax}`)
        })
        let eq = terms.join(' + ').replace('+ -', '- ')
        if (!eq) eq = '0'
        eq = `${eq} = ${fmt(d)}`
        facts.push({
          group: '根面',
          label: `\\pi_{${A.name}${B.name}}`,
          value: eq,
          num: null,
          how: '(\\vec{O_2}-\\vec{O_1})\\cdot\\vec{x} = \\frac{|O_2|^2-|O_1|^2-r_2^2+r_1^2}{2}',
          why: '两球面方程相减得根面',
          shape: null,
        })
        objects.push({ type: 'plane', name: `π_${A.name}${B.name}`, n, d, color: nextColor() })
        const signed = (n[0] * A.c[0] + n[1] * A.c[1] + n[2] * A.c[2] - d) / ln
        const dist = Math.abs(signed)
        facts.push({
          group: '根面',
          label: `d(O_{${A.name}}, \\pi_{${A.name}${B.name}})`,
          value: engine.nice(dist),
          num: dist,
          how: '\\dfrac{|\\vec n\\cdot O_1 - d|}{|\\vec n|}',
          why: '球心到根面的距离',
          shape: null,
        })
        const rho2 = A.r * A.r - signed * signed
        if (rho2 > 1e-9) {
          facts.push({
            group: '根面',
            label: `\\rho_{${A.name}\\cap ${B.name}}`,
            value: engine.nice(Math.sqrt(rho2)),
            num: Math.sqrt(rho2),
            how: '\\rho = \\sqrt{r_1^2 - d_1^2}',
            why: '两球交圆落在根面上',
            shape: null,
          })
        } else if (Math.abs(rho2) <= 1e-9) {
          facts.push({
            group: '根面',
            label: `${A.name} \\cap ${B.name}`,
            value: '\\text{相切}',
            num: 0,
            how: 'd_1 = \\pm r_1',
            why: '两球相切，交点在根面上',
            shape: null,
          })
        } else {
          facts.push({
            group: '根面',
            label: `${A.name}, ${B.name}`,
            value: '\\text{相离（根面仍在）}',
            num: null,
            how: 'r_1^2 - d_1^2 < 0',
            why: '无实交圆；根面是等幂点的轨迹',
            shape: null,
          })
        }
      }
    }
    if (facts.length) sections.push({ id: 'radical', title: '两球根面', subtitle: '等幂点轨迹 · 交圆平面', tone: 'geo', facts })
  }

  // Line–sphere: every pair of 3D points defines a line; intersect with each sphere.
  if (spheres.length && pts3.length >= 2) {
    const facts: RustFact[] = []
    const maxPairs = 6
    let pairs = 0
    for (let i = 0; i < pts3.length; i++) {
      for (let j = i + 1; j < pts3.length; j++) {
        if (pairs >= maxPairs) break
        const A = pts3[i]
        const B = pts3[j]
        const d = [B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]]
        const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
        if (dd < 1e-16) continue
        pairs++
        for (const s of spheres) {
          const ac = [A.p[0] - s.c[0], A.p[1] - s.c[1], A.p[2] - s.c[2]]
          const qa = dd
          const qb = 2 * (d[0] * ac[0] + d[1] * ac[1] + d[2] * ac[2])
          const qc = ac[0] * ac[0] + ac[1] * ac[1] + ac[2] * ac[2] - s.r * s.r
          const disc = qb * qb - 4 * qa * qc
          const lab = `${A.name}${B.name}`
          if (disc < -1e-9) {
            facts.push({
              group: '直线与球面',
              label: `${lab} \\cap ${s.name}`,
              value: '\\varnothing',
              num: null,
              how: '\\Delta < 0',
              why: '直线与球面相离',
              shape: null,
            })
          } else if (Math.abs(disc) <= 1e-9) {
            const t0 = -qb / (2 * qa)
            const q = [A.p[0] + t0 * d[0], A.p[1] + t0 * d[1], A.p[2] + t0 * d[2]]
            facts.push({
              group: '直线与球面',
              label: `${lab} \\cap ${s.name}`,
              value: '\\text{相切}',
              num: 0,
              how: '\\Delta = 0',
              why: '直线与球面相切',
              shape: { type: 'point3', x: q[0], y: q[1], z: q[2], label: `${lab}∩${s.name}` },
            })
          } else {
            const sq = Math.sqrt(disc)
            const t1 = (-qb - sq) / (2 * qa)
            const t2 = (-qb + sq) / (2 * qa)
            const q1 = [A.p[0] + t1 * d[0], A.p[1] + t1 * d[1], A.p[2] + t1 * d[2]]
            const q2 = [A.p[0] + t2 * d[0], A.p[1] + t2 * d[1], A.p[2] + t2 * d[2]]
            facts.push({
              group: '直线与球面',
              label: `P_{${lab}\\cap ${s.name},1}`,
              value: `\\left(${fmt(q1[0])},\\ ${fmt(q1[1])},\\ ${fmt(q1[2])}\\right)`,
              num: null,
              how: '|A + t(B-A) - O|^2 = r^2',
              why: '直线与球面的交点',
              shape: { type: 'point3', x: q1[0], y: q1[1], z: q1[2], label: `${lab}∩${s.name}` },
            })
            facts.push({
              group: '直线与球面',
              label: `P_{${lab}\\cap ${s.name},2}`,
              value: `\\left(${fmt(q2[0])},\\ ${fmt(q2[1])},\\ ${fmt(q2[2])}\\right)`,
              num: null,
              how: '|A + t(B-A) - O|^2 = r^2',
              why: '直线与球面的交点',
              shape: { type: 'point3', x: q2[0], y: q2[1], z: q2[2], label: `${lab}∩${s.name}` },
            })
            const chord = Math.hypot(q2[0] - q1[0], q2[1] - q1[1], q2[2] - q1[2])
            facts.push({
              group: '直线与球面',
              label: `|P_1P_2|_{${lab}\\cap ${s.name}}`,
              value: engine.nice(chord),
              num: chord,
              how: '两交点距离',
              why: '弦长',
              shape: null,
            })
          }
        }
      }
      if (pairs >= maxPairs) break
    }
    if (facts.length) sections.push({ id: 'line-sphere', title: '直线 ∩ 球面', subtitle: '交点 · 相切 · 相离', tone: 'geo', facts })
  }


  if (marks.length) objects.push({ type: 'marks', pts: marks })

  // ---- dimension ---------------------------------------------------------------------------
  const reasons3: string[] = []
  if (good.some((i) => i.st.kind === 'surface')) reasons3.push('z = f(x, y) 是空间曲面')
  if (planes.length) reasons3.push('含 x, y, z 的线性方程是平面')
  if (good.some((i) => i.st.kind === 'implicit3') && !planes.length) reasons3.push('三元方程是空间曲面')
  if (pts3.length) reasons3.push('点有三个坐标')
  if (numVecs.some((v) => v.v.length === 3)) reasons3.push('向量有三个分量')
  if (good.some((i) => i.st.kind === 'param' && i.st.comps.length === 3)) reasons3.push('参数曲线有三个分量')
  const dim: 2 | 3 = reasons3.length ? 3 : 2
  const dimReason = dim === 3 ? reasons3[0] : good.some((i) => i.st.kind === 'triangle' || i.st.kind === 'point') ? '平面几何：只涉及 x, y' : '只含 x, y：平面直角坐标系'

  const factCount = sections.reduce((n, s) => n + s.facts.filter((f) => f.group !== '已知').length, 0)
  return { dim, dimReason, givens, errors, solve, env, sections, factCount, objects, equalAspect, stats: getStats() }
}

function renameTri(s: string, names: string) {
  if (names === 'ABC') return s
  const map: Record<string, string> = { A: names[0], B: names[1], C: names[2] }
  return s.replace(/\\angle ([ABC])/g, (_, k) => `\\angle ${map[k]}`)
}

export function fmt(v: number) {
  if (!Number.isFinite(v)) return String(v)
  const r = Math.round(v * 1e4) / 1e4
  return Object.is(r, -0) ? '0' : String(r)
}

function domainHint(src: string) {
  const hints: string[] = []
  if (/\bln|log|lg/.test(src)) hints.push('\\ln u: u > 0')
  if (/sqrt|√/.test(src)) hints.push('\\sqrt{u}: u \\ge 0')
  if (/\//.test(src)) hints.push('\\frac{p}{q}: q \\ne 0')
  if (/tan/.test(src)) hints.push('\\tan u: u \\ne \\frac{\\pi}{2} + k\\pi')
  if (/asin|acos|arcsin|arccos/.test(src)) hints.push('|u| \\le 1')
  return hints.join(',\\ ')
}

/** Isolated poles (e.g. 1/x at 0) are invisible to grid scans; probe denominators directly. */
function poleHints(src: string, env: Env) {
  if (!src.includes('/')) return []
  const out: number[] = []
  for (let x = -RANGE; x <= RANGE; x += 0.5) {
    const v = engine.eval(src, { ...env, x })
    if (!Number.isFinite(v)) out.push(x)
  }
  return out.slice(0, 6)
}

const tidy = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v)

/** Exact a, b, c when F(x) is a polynomial of degree ≤ 2 in x, else null. */
function quadraticCoeffs(F: string, env: Env): [number, number, number] | null {
  const f = (x: number) => engine.eval(F, { ...env, x })
  const c = f(0)
  const p = f(1)
  const m = f(-1)
  const a = (p + m) / 2 - c
  const b = (p - m) / 2
  if (![a, b, c].every(Number.isFinite)) return null
  for (const t of [2, -3, 0.5, 7.25]) {
    const pred = a * t * t + b * t + c
    if (!(Math.abs(f(t) - pred) <= 1e-8 * (1 + Math.abs(pred)))) return null
  }
  return [tidy(a), tidy(b), tidy(c)]
}

/** Solve F(x) = 0: closed form for linear / quadratic, Rust root finding otherwise. */
function equationFacts(st: Extract<Statement, { kind: 'equation1' }>, name: string, env: Env): { facts: RustFact[]; roots: number[] } {
  const facts: RustFact[] = []
  const F = st.F
  const graph = `${name}(x) = ${engine.latex(F)}`
  const rootFact = (label: string, x: number, why: string, how = ''): RustFact => ({ group: '方程的解', label, value: engine.nice(x), num: x, how, why, shape: { type: 'point', x, y: 0, label: `x=${fmt(x)}` } })
  const q = quadraticCoeffs(F, env)
  if (q && Math.abs(q[0]) > 1e-12) {
    const [a, b, c] = q
    const disc = tidy(b * b - 4 * a * c)
    const h = -b / (2 * a)
    const k = c - (b * b) / (4 * a)
    facts.push({ group: '一元二次方程', label: 'a,\\ b,\\ c', value: `${engine.nice(a)},\\ ${engine.nice(b)},\\ ${engine.nice(c)}`, num: null, how: 'ax^2 + bx + c = 0', why: '整理成一般式', shape: null })
    facts.push({
      group: '一元二次方程',
      label: '\\Delta',
      value: engine.nice(disc),
      num: disc,
      how: '\\Delta = b^2 - 4ac',
      why: disc > 1e-12 ? 'Δ > 0：两个不相等的实根' : Math.abs(disc) <= 1e-12 ? 'Δ = 0：两个相等的实根（重根）' : 'Δ < 0：没有实根，有一对共轭复根',
      shape: null,
    })
    const roots: number[] = []
    if (Math.abs(disc) <= 1e-12) {
      roots.push(h)
      facts.push(rootFact('x_1 = x_2', h, '重根：抛物线与 x 轴相切', 'x = -\\frac{b}{2a}'))
    } else if (disc > 0) {
      const r = Math.sqrt(disc)
      const xs = [(-b - r) / (2 * a), (-b + r) / (2 * a)].sort((u, v) => u - v)
      roots.push(...xs)
      xs.forEach((x, i) => facts.push(rootFact(`x_{${i + 1}}`, x, '求根公式', 'x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}')))
    } else {
      const im = Math.sqrt(-disc) / (2 * Math.abs(a))
      facts.push({ group: '方程的解', label: 'x_{1,2}', value: `${engine.nice(h)} \\pm ${engine.nice(im)}\\,i`, num: null, how: 'x = \\frac{-b \\pm i\\sqrt{-\\Delta}}{2a}', why: '实数范围内无解', shape: null })
    }
    facts.push({ group: '根与系数', label: 'x_1 + x_2', value: engine.nice(-b / a), num: -b / a, how: '-\\frac{b}{a}', why: '韦达定理', shape: null })
    facts.push({ group: '根与系数', label: 'x_1 x_2', value: engine.nice(c / a), num: c / a, how: '\\frac{c}{a}', why: '韦达定理', shape: null })
    facts.push({ group: '对应的抛物线', label: '\\text{顶点}', value: `\\left(${engine.nice(h).split(' ')[0]},\\ ${engine.nice(k).split(' ')[0]}\\right)`, num: null, how: graph, why: a > 0 ? '开口向上，顶点是最低点' : '开口向下，顶点是最高点', shape: { type: 'point', x: h, y: k, label: '顶点' } })
    facts.push({ group: '对应的抛物线', label: '\\text{对称轴}', value: `x = ${engine.nice(h)}`, num: h, how: 'x = -\\frac{b}{2a}', why: '配方', shape: null })
    return { facts, roots }
  }
  if (q && Math.abs(q[1]) > 1e-12) {
    const x = -q[2] / q[1]
    facts.push(rootFact('x', x, '一元一次方程：移项、系数化为 1', `${engine.nice(q[1])}x = ${engine.nice(-q[2])}`))
    return { facts, roots: [x] }
  }
  if (q) {
    facts.push({ group: '方程的解', label: '\\text{解}', value: Math.abs(q[2]) < 1e-12 ? '\\text{任意实数}' : '\\text{无解}', num: null, how: graph, why: '化简后不含 x', shape: null })
    return { facts, roots: [] }
  }
  const zs = engine.roots(F, 'x', env, -RANGE, RANGE)
  const gaps = engine.domainGaps(F, 'x', env, -RANGE, RANGE)
  if (gaps.length || F.includes('/')) {
    const hint = domainHint(F)
    if (hint) facts.push({ group: '定义域', label: '\\text{要求}', value: hint, num: null, how: '', why: '方程有意义的条件', shape: null })
  }
  if (!zs.length) facts.push({ group: '方程的解', label: '\\text{解}', value: '\\text{无实根}', num: null, how: graph, why: `在 [-${RANGE}, ${RANGE}] 内 y = ${name}(x) 不碰 x 轴`, shape: null })
  else if (zs.length > 12) facts.push({ group: '方程的解', label: '\\text{解}', value: `\\text{共 ${zs.length} 个}`, num: null, how: graph, why: `在 [-${RANGE}, ${RANGE}] 内（周期性），已在图上标出`, shape: null })
  else
    zs.forEach((x, i) => {
      const d = (engine.eval(F, { ...env, x: x + 1e-5 }) - engine.eval(F, { ...env, x: x - 1e-5 })) / 2e-5
      facts.push(rootFact(`x_{${i + 1}}`, x, Math.abs(d) < 1e-4 ? '重根（图像与 x 轴相切）' : 'Rust 数值求根', graph))
    })
  return { facts, roots: zs }
}

function parseSphere(F: string, env: Env): { c: number[]; r: number } | null {
  // F = x² + y² + z² + Dx + Ey + Fz + G (up to a common factor)
  const f = (x: number, y: number, z: number) => engine.eval(F, { ...env, x, y, z })
  const g = f(0, 0, 0)
  const ax = (f(1, 0, 0) + f(-1, 0, 0)) / 2 - g
  const ay = (f(0, 1, 0) + f(0, -1, 0)) / 2 - g
  const az = (f(0, 0, 1) + f(0, 0, -1)) / 2 - g
  if (!(Math.abs(ax - ay) < 1e-9 && Math.abs(ay - az) < 1e-9 && Math.abs(ax) > 1e-12)) return null
  const D = (f(1, 0, 0) - f(-1, 0, 0)) / 2 / ax
  const E = (f(0, 1, 0) - f(0, -1, 0)) / 2 / ax
  const G = (f(0, 0, 1) - f(0, 0, -1)) / 2 / ax
  const c = [-D / 2, -E / 2, -G / 2]
  const test = f(2.3, -1.1, 0.7) / ax
  const pred = 2.3 ** 2 + 1.1 ** 2 + 0.7 ** 2 + D * 2.3 - E * 1.1 + G * 0.7 + g / ax
  if (Math.abs(test - pred) > 1e-7 * (1 + Math.abs(test))) return null
  const r2 = c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - g / ax
  if (r2 <= 0) return null
  return { c, r: Math.sqrt(r2) }
}

function sphereFactsFrom(sph: { c: number[]; r: number }): RustFact[] {
  const { c, r } = sph
  return [
    { group: '球面', label: '\\text{类型}', value: '\\text{球面}', num: null, how: '(x-a)^2 + (y-b)^2 + (z-c)^2 = r^2', why: '配方', shape: null },
    { group: '球面', label: '\\text{球心}', value: `\\left(${fmt(c[0])},\\ ${fmt(c[1])},\\ ${fmt(c[2])}\\right)`, num: null, how: '', why: '配方', shape: { type: 'point3', x: c[0], y: c[1], z: c[2], label: '球心' } },
    { group: '球面', label: 'r', value: engine.nice(r), num: r, how: '', why: '半径', shape: null },
    { group: '球面', label: 'V', value: engine.nice((4 / 3) * Math.PI * r ** 3), num: null, how: '\\frac43\\pi r^3', why: '体积', shape: null },
    { group: '球面', label: 'S', value: engine.nice(4 * Math.PI * r * r), num: null, how: '4\\pi r^2', why: '表面积', shape: null },
  ]
}

// ---------------------------------------------------------------------------
// Light-weight per-card summary for the canvas

export interface CardSummary {
  lines: { latex: string; kind: string; error?: string }[]
  dim: 2 | 3
  plottable: boolean
  factCount: number
  headline: string
  hasUnknowns: boolean
  kinds: Statement['kind'][]
}

const summaryCache = new Map<string, CardSummary>()

export function summarizeCard(text: string): CardSummary {
  const hit = summaryCache.get(text)
  if (hit) return hit
  const sts = parseCard(text)
  const arrowName = text.trim().match(/^\\(?:vec|overrightarrow)\{([a-z])\}/)
  const lines = sts.map((s) => ({
    latex: arrowName && s.kind === 'vector' ? `\\vec{${arrowName[1]}}` : statementLatex(s),
    kind: kindLabel(s),
    error: s.kind === 'error' ? s.message : undefined,
  }))
  let a: Analysis | null = null
  try {
    a = analyze([{ id: 'card', text }])
  } catch {
    a = null
  }
  const ok = sts.filter((s) => s.kind !== 'error')
  const kinds = new Set(ok.map((s) => s.kind))
  let headline = '公式'
  if (kinds.has('triangle')) headline = '解三角形'
  else if (kinds.has('circle') || kinds.has('chords')) headline = '圆与弦'
  else if (kinds.has('pointDef') || kinds.has('vectorDef')) headline = '中点与分点'
  else if (kinds.has('point') && ok.filter((s) => s.kind === 'point').length >= 2) headline = '坐标几何'
  else if (a?.solve) headline = '待定系数 / 求未知量'
  else if (kinds.has('vector')) headline = '向量'
  else if (kinds.has('surface')) headline = '空间曲面'
  else if (kinds.has('implicit3')) headline = '空间方程'
  else if (kinds.has('equation1')) headline = '解方程'
  else if (kinds.has('implicit2')) headline = '平面曲线'
  else if (kinds.has('curve')) headline = '函数'
  else if (kinds.has('param')) headline = '参数曲线'
  const summary: CardSummary = {
    lines,
    dim: a?.dim ?? 2,
    plottable: ok.length > 0 && !!a && (a.objects.length > 0 || a.factCount > 0),
    factCount: a?.factCount ?? 0,
    headline,
    hasUnknowns: !!a?.solve,
    kinds: [...kinds],
  }
  if (summaryCache.size > 300) summaryCache.clear()
  summaryCache.set(text, summary)
  return summary
}
