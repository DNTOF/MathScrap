import { Bot, Copy, Cpu, PenTool, Plug } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { testConnection } from '@/ai/client'
import { missingConfig, normalizeProvider, type AiConfig } from '@/ai/config'
import { browserTransport } from '@/ai/browserTransport'
import { loadAiConfig, saveAiConfig } from '@/ai/storage'
import { TOOL_SPECS } from '@/ai/tools'
import { useI18n } from '@/i18n/useI18n'
import type { MessageKey } from '@/i18n/messages'
import { engine } from '@/wasm/engine'

const TOOL_BLURB: Record<string, MessageKey> = {
  page_read: 'toolPageRead',
  page_add_formula: 'toolPageAdd',
  page_update_formula: 'toolPageUpdate',
  solve_analyze: 'toolSolve',
  plot_open: 'toolPlotOpen',
  plot_set_view: 'toolPlotView',
  ink_read: 'toolInk',
}

export interface Prefs {
  penOnly: boolean
  showGrid: boolean
  showHints: boolean
  /** handwriting → formula candidates raised automatically on settled ink (default on) */
  autoOcr: boolean
}

export function SettingsSheet({ open, onOpenChange, prefs, setPrefs, side }: { open: boolean; onOpenChange: (o: boolean) => void; prefs: Prefs; setPrefs: (p: Prefs) => void; side: 'right' | 'bottom' }) {
  const { t } = useI18n()
  const [ai, setAi] = useState<AiConfig>(loadAiConfig)
  const [testing, setTesting] = useState(false)
  const gap = missingConfig(ai)
  const save = () => {
    saveAiConfig(ai)
    toast.success(t('savedLocal'))
  }
  const test = async () => {
    if (testing) return
    const problem = missingConfig(ai)
    if (problem) {
      toast.error(problem)
      return
    }
    saveAiConfig(ai)
    setTesting(true)
    try {
      toast.success(await testConnection(ai, browserTransport()))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('connectFailed'))
    } finally {
      setTesting(false)
    }
  }
  const placeholders =
    ai.provider === 'anthropic'
      ? { base: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' }
      : ai.provider === 'local'
        ? { base: 'http://127.0.0.1:11434/v1', model: 'qwen2.5' }
        : { base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' }
  const row = (label: string, desc: string, checked: boolean, on: (v: boolean) => void) => (
    <label className="flex items-start justify-between gap-3 rounded-xl bg-kraft-50/50 px-3 py-2.5">
      <span>
        <span className="block text-[13.5px] font-medium text-kraft-800">{label}</span>
        <span className="block text-[11.5px] text-kraft-600">{desc}</span>
      </span>
      <Switch checked={checked} onCheckedChange={on} />
    </label>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={`kraft-panel overflow-y-auto bg-transparent ${side === 'bottom' ? 'max-h-[88dvh] rounded-t-2xl' : 'w-[400px] sm:max-w-[400px]'}`} data-no-board>
        <SheetHeader>
          <SheetTitle className="hand text-[28px] text-kraft-800">{t('settingsTitle')}</SheetTitle>
          <SheetDescription className="text-kraft-600">{t('settingsLead')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-8">
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-widest text-kraft-600">
              <PenTool className="size-3.5" /> {t('writing')}
            </h3>
            {row(t('penOnly'), t('penOnlyDesc'), prefs.penOnly, (v) => setPrefs({ ...prefs, penOnly: v }))}
            {row(t('autoOcr'), t('autoOcrDesc'), prefs.autoOcr, (v) => setPrefs({ ...prefs, autoOcr: v }))}
            {row(t('showHints'), t('showHintsDesc'), prefs.showHints, (v) => setPrefs({ ...prefs, showHints: v }))}
            {row(t('showGrid'), t('showGridDesc'), prefs.showGrid, (v) => setPrefs({ ...prefs, showGrid: v }))}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-widest text-kraft-600">
              <Bot className="size-3.5" /> {t('aiSection')}
            </h3>
            <p className="rounded-xl bg-kraft-200/60 px-3 py-2 text-[12px] leading-relaxed text-kraft-800">{t('aiPrivacy')}</p>
            <div className="grid gap-2">
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">{t('provider')}</Label>
                <select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: normalizeProvider(e.target.value) })} className="h-10 rounded-lg border border-kraft-600/25 bg-kraft-50/70 px-2 text-[13px] outline-none">
                  <option value="openai-compatible">{t('providerOpenAI')}</option>
                  <option value="anthropic">{t('providerAnthropic')}</option>
                  <option value="local">{t('providerLocal')}</option>
                </select>
              </div>
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">Base URL</Label>
                <Input value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} placeholder={placeholders.base} className="h-10 bg-kraft-50/70" />
              </div>
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">{t('model')}</Label>
                <Input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} placeholder={placeholders.model} className="h-10 bg-kraft-50/70" />
              </div>
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">{t('apiKey')}</Label>
                <Input type="password" value={ai.apiKey} onChange={(e) => setAi({ ...ai, apiKey: e.target.value })} placeholder={t('apiKeyPh')} className="h-10 bg-kraft-50/70" />
              </div>
              <div className="flex gap-2">
                <button onClick={save} className="h-10 flex-1 rounded-xl bg-kraft-700 text-[13px] font-medium text-kraft-50 hover:bg-kraft-800">
                  {t('saveLocal')}
                </button>
                <button type="button" onClick={() => void test()} disabled={testing || !!gap} className="h-10 flex-1 rounded-xl border border-kraft-600/30 text-[13px] text-kraft-800 hover:bg-kraft-200 disabled:cursor-not-allowed disabled:opacity-40">
                  {testing ? t('testing') : t('testConnection')}
                </button>
              </div>
              {gap && <p className="text-[12px] leading-relaxed text-kraft-600">{gap}. {t('fillFirst')}</p>}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-widest text-kraft-600">
              <Plug className="size-3.5" /> {t('mcpSection')}
            </h3>
            <p className="text-[12px] leading-relaxed text-kraft-700">{t('mcpBody')}</p>
            <ul className="flex flex-col gap-1.5">
              {TOOL_SPECS.map((spec) => (
                <li key={spec.name} className="rounded-xl bg-kraft-50/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-[12.5px] font-semibold text-kraft-800">{spec.name}</code>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${spec.status === 'local' ? 'bg-ink-green/85 text-kraft-50' : 'bg-kraft-300 text-kraft-800'}`}>{spec.status === 'local' ? t('toolLocal') : t('toolPlanned')}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-kraft-600">{TOOL_BLURB[spec.name] ? t(TOOL_BLURB[spec.name]) : spec.name}</div>
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(JSON.stringify(TOOL_SPECS, null, 2))
                toast.success(t('copiedSpecs'))
              }}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-kraft-600/30 text-[13px] text-kraft-800 hover:bg-kraft-200"
            >
              <Copy className="size-4" /> {t('copySpecs')}
            </button>
          </section>

          <section className="flex flex-col gap-1 rounded-xl bg-kraft-50/50 px-3 py-2.5 text-[12px] text-kraft-700">
            <h3 className="flex items-center gap-1.5 font-semibold text-kraft-800">
              <Cpu className="size-3.5" /> {t('engineSection')}
            </h3>
            <span>{t('engineLine', { version: engine.version() })}</span>
            <span>{t('engineDoes')}</span>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
