import { Bot, Download, Maximize, Minus, MoreHorizontal, Plus, Redo2, Settings2, Trash2, Undo2, Upload } from 'lucide-react'
import { APP_VERSION } from '@/version'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SAMPLES } from '@/board/samples'
import { useI18n } from '@/i18n/useI18n'
import { cn } from '@/lib/utils'
import { MOD } from '@/input/snippets'

interface Props {
  compact: boolean
  scale: number
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onZoom: (f: number) => void
  onFit: () => void
  onClear: () => void
  onSettings: () => void
  onAssist: () => void
  onExport: () => void
  onImport: () => void
  onSample: (blocks: string[]) => void
}

function IconBtn({ label, onClick, disabled, children, compact }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; compact: boolean }) {
  const b = (
    <button onClick={onClick} disabled={disabled} aria-label={label} className={cn('grid place-items-center rounded-full text-kraft-800 transition hover:bg-kraft-800/10 disabled:opacity-30', compact ? 'size-11' : 'size-9')}>
      {children}
    </button>
  )
  if (compact) return b
  return (
    <Tooltip>
      <TooltipTrigger render={b} />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** One small pill: undo, redo and a "…" menu. The paper itself carries no branding. */
export function TopBar(p: Props) {
  const { lang, setLang, t } = useI18n()
  const [menu, setMenu] = useState(false)
  const zoom = `${Math.round(p.scale * 100)}%`
  const row = 'flex h-10 items-center gap-2 rounded-xl px-2.5 text-[13px] text-kraft-800 hover:bg-kraft-800/10'
  return (
    <>
      <div className="paper-chrome absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 flex items-center gap-0.5 rounded-full p-1" data-no-board>
        <IconBtn label={`${t('undo')} (${MOD} Z)`} onClick={p.onUndo} disabled={!p.canUndo} compact={p.compact}>
          <Undo2 className="size-[18px]" />
        </IconBtn>
        <IconBtn label={`${t('redo')} (${MOD} Shift Z)`} onClick={p.onRedo} disabled={!p.canRedo} compact={p.compact}>
          <Redo2 className="size-[18px]" />
        </IconBtn>
        <Popover open={menu} onOpenChange={setMenu}>
          <PopoverTrigger className={cn('grid place-items-center rounded-full text-kraft-800 hover:bg-kraft-800/10', p.compact ? 'size-11' : 'size-9')} aria-label={t('more')}>
            <MoreHorizontal className="size-5" />
          </PopoverTrigger>
          <PopoverContent align="end" className="paper-chrome w-[min(330px,calc(100vw-24px))] gap-0 bg-transparent p-1.5" data-no-board>
            <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-1.5">
              <div className="text-[12px] font-semibold tracking-tight text-kraft-800/70">
                MathScrap <span className="font-normal tabular-nums">{APP_VERSION}</span>
              </div>
              <div role="group" aria-label={t('langLabel')} className="flex rounded-full bg-kraft-800/10 p-0.5 text-[11px]">
                <button type="button" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')} className={cn('h-6 rounded-full px-2', lang === 'zh' ? 'bg-kraft-50 text-kraft-800' : 'text-kraft-700')}>
                  {t('langZh')}
                </button>
                <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} className={cn('h-6 rounded-full px-2', lang === 'en' ? 'bg-kraft-50 text-kraft-800' : 'text-kraft-700')}>
                  {t('langEn')}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 pb-1.5">
              <button onClick={() => p.onZoom(1 / 1.2)} className="grid size-10 place-items-center rounded-xl hover:bg-kraft-800/10" aria-label={t('zoomOut')}>
                <Minus className="size-4" />
              </button>
              <button onClick={p.onFit} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] tabular-nums hover:bg-kraft-800/10" title={t('fitView')}>
                <Maximize className="size-4" /> {zoom}
              </button>
              <button onClick={() => p.onZoom(1.2)} className="grid size-10 place-items-center rounded-xl hover:bg-kraft-800/10" aria-label={t('zoomIn')}>
                <Plus className="size-4" />
              </button>
            </div>
            <div className="border-t border-kraft-800/10 pt-1.5">
              <div className="px-2.5 pb-1 text-[11px] text-kraft-700">{t('examples')}</div>
              <div className="flex max-h-[46dvh] flex-col overflow-y-auto">
                {SAMPLES.map((s) => (
                  <button key={s.titleKey} onClick={() => p.onSample(s.blocks)} className="rounded-xl px-2.5 py-1.5 text-left hover:bg-kraft-800/10">
                    <div className="text-[13px] text-kraft-800">{t(s.titleKey)}</div>
                    <div className="truncate font-mono text-[11px] text-kraft-700/80">{s.blocks.join('   ·   ')}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1.5 border-t border-kraft-800/10 pt-1.5">
              <button
                onClick={() => {
                  setMenu(false)
                  p.onAssist()
                }}
                className={cn(row, 'w-full')}
              >
                <Bot className="size-4" /> {t('assist')}
              </button>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <button
                onClick={() => {
                  setMenu(false)
                  p.onExport()
                }}
                className={row}
              >
                <Download className="size-4" /> {t('exportSheet')}
              </button>
              <button
                onClick={() => {
                  setMenu(false)
                  p.onImport()
                }}
                className={row}
              >
                <Upload className="size-4" /> {t('importSheet')}
              </button>
              <button onClick={p.onSettings} className={row}>
                <Settings2 className="size-4" /> {t('settings')}
              </button>
              <button onClick={p.onClear} className={cn(row, 'text-ink-red')}>
                <Trash2 className="size-4" /> {t('clearPage')}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}
