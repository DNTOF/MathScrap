import { AlertTriangle, ArrowDown, Cpu, Eye, EyeOff, Sparkles } from 'lucide-react'
import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import type { Analysis, FactSection } from '@/math/scene'

interface Props {
  analysis: Analysis
  visible: Set<string>
  onToggleShape: (key: string) => void
  onPickSolution: (i: number) => void
}

const TONE: Record<FactSection['tone'], string> = {
  solve: 'border-ink-green/40 bg-[#dfe0bf]/70',
  geo: 'border-ink-blue/25 bg-kraft-50/60',
  func: 'border-kraft-600/25 bg-kraft-50/60',
  vec: 'border-[#5b3f6e]/25 bg-kraft-50/60',
  inter: 'border-ink-red/30 bg-[#f0dcc6]/70',
  warn: 'border-ink-red/40 bg-[#f1d5c4]/70',
}

export const factKey = (sectionId: string, i: number) => `${sectionId}#${i}`

export function FactsPanel({ analysis: a, visible, onToggleShape, onPickSolution }: Props) {
  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="rounded-xl border border-kraft-600/25 bg-kraft-50/50 p-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-kraft-800">
          <span className="rounded-md bg-kraft-700 px-1.5 py-0.5 text-[11px] text-kraft-50">已知</span>
          <span>{a.givens.length} 条</span>
          <ArrowDown className="size-3.5 -rotate-90 text-kraft-500" />
          <span className="flex items-center gap-1 rounded-md bg-ink-green px-1.5 py-0.5 text-[11px] text-kraft-50">
            <Sparkles className="size-3" />
            推出
          </span>
          <span>{a.factCount} 项</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {a.givens.map((g, i) => (
            <span key={i} className="inline-flex max-w-full items-center gap-1.5 overflow-x-auto rounded-lg border border-kraft-600/20 bg-kraft-100/80 px-2 py-1 text-[14px]">
              <span className="shrink-0 text-[10px] text-kraft-600">{g.kind}</span>
              <Tex tex={g.latex} />
            </span>
          ))}
        </div>
      </div>

      {a.errors.length > 0 && (
        <div className="rounded-xl border border-ink-red/30 bg-[#f1d5c4]/70 p-3 text-[13px] text-ink-red">
          {a.errors.map((e, i) => (
            <div key={i} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <b className="font-mono">{e.src}</b>：{e.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {a.solve && a.solve.solutions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-kraft-700">
          <span>多组解：</span>
          {a.solve.solutions.map((s, i) => (
            <button
              key={i}
              onClick={() => onPickSolution(i)}
              className={cn('touch-target rounded-full border px-2.5 py-1 font-mono text-[12px] transition', i === a.solve!.index ? 'border-kraft-700 bg-kraft-700 text-kraft-50' : 'border-kraft-600/30 bg-kraft-100 hover:bg-kraft-50')}
            >
              {a.solve!.unknowns.map((u, k) => `${u}=${+s[k].toFixed(4)}`).join(', ')}
            </button>
          ))}
        </div>
      )}
      {a.solve?.note && <div className="rounded-lg bg-kraft-200/60 px-3 py-2 text-[12px] leading-relaxed text-kraft-800">{a.solve.note}</div>}

      {a.sections.length === 0 && (
        <div className="rounded-xl border border-dashed border-kraft-600/40 p-4 text-center text-[13px] text-kraft-700">
          这里暂时没有可推导的量。试试写下更多条件，比如 <span className="font-mono">过(1, 3)</span> 或 <span className="font-mono">AB ⊥ BC</span>。
        </div>
      )}

      {a.sections.map((sec) => {
        const groups = new Map<string, { f: (typeof sec.facts)[number]; i: number }[]>()
        sec.facts.forEach((f, i) => {
          const g = groups.get(f.group) ?? []
          g.push({ f, i })
          groups.set(f.group, g)
        })
        return (
          <section key={sec.id} className={cn('rounded-xl border p-3', TONE[sec.tone])}>
            <header className="mb-2">
              <h3 className="hand text-[22px] leading-none font-bold text-kraft-800">{sec.title}</h3>
              {sec.subtitle && <p className="mt-1 text-[11.5px] text-kraft-600">{sec.subtitle}</p>}
            </header>
            <div className="flex flex-col gap-2.5">
              {[...groups.entries()].map(([g, rows]) => (
                <div key={g}>
                  <div className="mb-1 text-[10.5px] font-semibold tracking-widest text-kraft-500 uppercase">{g}</div>
                  <ul className="flex flex-col divide-y divide-kraft-600/10">
                    {rows.map(({ f, i }) => {
                      const key = factKey(sec.id, i)
                      const on = visible.has(key)
                      return (
                        <li key={i} className="group/fact flex items-start gap-2 py-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="overflow-x-auto overflow-y-hidden text-[15px]">
                              <Tex tex={`${f.label} = ${f.value}`} />
                            </div>
                            {(f.why || f.how) && (
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-kraft-600">
                                {f.why && <span>{f.why}</span>}
                                {f.how && (
                                  <span className="overflow-x-auto opacity-90">
                                    <Tex tex={f.how} />
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {f.shape && (
                            <button
                              onClick={() => onToggleShape(key)}
                              className={cn('touch-target grid size-7 shrink-0 place-items-center rounded-full border transition', on ? 'border-[#b9852a] bg-[#b9852a] text-kraft-50' : 'border-kraft-600/30 text-kraft-600 hover:bg-kraft-100')}
                              title={on ? '从图上隐藏' : '在图上标出'}
                              aria-label={on ? '从图上隐藏' : '在图上标出'}
                            >
                              {on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )
      })}

      <div className="flex items-center gap-1.5 text-[11px] text-kraft-600">
        <Cpu className="size-3.5" />
        Rust → WASM 引擎 · {a.stats.calls} 次调用 · {a.stats.ms.toFixed(1)} ms
      </div>
    </div>
  )
}
