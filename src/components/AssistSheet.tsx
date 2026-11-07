import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { assist, type AssistStep } from '@/ai/client'
import { missingConfig } from '@/ai/config'
import { browserTransport } from '@/ai/browserTransport'
import { loadAiConfig } from '@/ai/storage'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { t } from '@/i18n/locale'
import { useI18n } from '@/i18n/useI18n'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  steps?: AssistStep[]
}

/**
 * A chrome sheet, not ink on the paper. Sends the formulas already on the sheet
 * plus the user's sentence, then applies tool calls (page_add_formula / solve_analyze / …).
 */
export function AssistSheet({
  open,
  onOpenChange,
  side,
  call,
  onOpenSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  side: 'right' | 'bottom'
  call: (name: string, args: Record<string, unknown>) => unknown
  onOpenSettings: () => void
}) {
  const { t: tr } = useI18n()
  const [prompt, setPrompt] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const cfg = loadAiConfig()
  const gap = missingConfig(cfg)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    if (running) return
    const current = loadAiConfig()
    const problem = missingConfig(current)
    if (problem) {
      toast.error(problem)
      return
    }
    const question = prompt.trim() || tr('assist')
    setPrompt('')
    setTurns((prev) => [...prev, { role: 'user', text: question }])
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    try {
      const page = call('page_read', {}) as { formulas?: { id: string; text: string }[]; strokes?: number }
      const out = await assist({
        config: current,
        prompt: question,
        formulas: page.formulas ?? [],
        strokes: page.strokes ?? 0,
        callTool: (name, args) => call(name, args),
        transport: browserTransport(),
        signal: ac.signal,
      })
      setTurns((prev) => [...prev, { role: 'assistant', text: out.text || tr('noModelText'), steps: out.steps }])
      if (out.steps.some((step) => step.name === 'page_add_formula' || step.name === 'page_update_formula')) toast.success(tr('wroteOnSheet'))
    } catch (e) {
      const message = e instanceof Error ? e.message : tr('requestFailed')
      if (message === t('cancelled')) toast(tr('cancelled'))
      else {
        toast.error(message)
        setTurns((prev) => [...prev, { role: 'assistant', text: message }])
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setRunning(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={`kraft-panel flex flex-col overflow-hidden bg-transparent ${side === 'bottom' ? 'max-h-[88dvh] rounded-t-2xl' : 'w-[420px] sm:max-w-[420px]'}`} data-no-board>
        <SheetHeader>
          <SheetTitle className="hand text-[28px] text-kraft-800">{tr('assistTitle')}</SheetTitle>
          <SheetDescription className="text-kraft-600">{tr('assistLead')}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          {gap && (
            <div className="rounded-xl bg-kraft-200/60 px-3 py-2 text-[12px] leading-relaxed text-kraft-800">
              {gap}. {tr('assistGap')}
              <button type="button" onClick={onOpenSettings} className="ml-2 underline">
                {tr('openSettings')}
              </button>
            </div>
          )}
          <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto">
            {turns.length === 0 && <p className="text-[12.5px] leading-relaxed text-kraft-600">{tr('assistEmpty')}</p>}
            {turns.map((turn, i) => (
              <div key={i} className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${turn.role === 'user' ? 'bg-kraft-700 text-kraft-50' : 'bg-kraft-50/70 text-kraft-800'}`}>
                <div className="whitespace-pre-wrap">{turn.text}</div>
                {turn.steps && turn.steps.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px] opacity-80">
                    {turn.steps.map((step, j) => (
                      <li key={j}>
                        {step.name}
                        {step.args.text ? ` · ${String(step.args.text)}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={tr('assistPh')}
            rows={3}
            disabled={running}
            className="w-full resize-none rounded-xl border border-kraft-600/25 bg-kraft-50/70 px-3 py-2 text-[13px] text-kraft-800 outline-none placeholder:text-kraft-600/70"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void run()} disabled={running || !!gap} className="h-10 flex-1 rounded-xl bg-kraft-700 text-[13px] font-medium text-kraft-50 hover:bg-kraft-800 disabled:cursor-not-allowed disabled:opacity-40">
              {running ? tr('assistRunning') : tr('assist')}
            </button>
            {running && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="h-10 rounded-xl border border-kraft-600/30 px-3 text-[13px] text-kraft-800 hover:bg-kraft-200"
              >
                {tr('cancel')}
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
