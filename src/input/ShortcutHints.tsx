import { Tex } from '@/components/Tex'
import { useI18n } from '@/i18n/useI18n'
import type { MessageKey } from '@/i18n/messages'
import { cn } from '@/lib/utils'
import { MOD, SNIPPETS, snippetKey } from './snippets'

const hintKey = (id: string) => (`hint${id[0].toUpperCase()}${id.slice(1)}`) as MessageKey

/**
 * The cheat-sheet "pencilled" onto the kraft page while typing — pointer-transparent,
 * low contrast, so it reads like notes on the paper rather than UI chrome.
 */
export function ShortcutHints({ visible, compact, placement = 'top' }: { visible: boolean; compact: boolean; placement?: 'top' | 'bottom' }) {
  const { t } = useI18n()
  const items = SNIPPETS.filter((s) => s.code)
  const extra = [
    { k: 'Enter', d: t('scEnter') },
    { k: 'Shift Enter', d: t('scShiftEnter') },
    { k: 'Tab', d: t('scTab') },
    { k: 'Esc', d: t('scEsc') },
    { k: 'G', d: t('scPlot') },
  ]
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute select-none transition-all duration-500',
        compact ? 'inset-x-3 top-[64px] z-10 [&>div]:rounded-2xl [&>div]:bg-[#e6d1ad]/92' : cn('z-0 left-1/2 w-[min(860px,86vw)] -translate-x-1/2', placement === 'top' ? 'top-[9%]' : 'bottom-[96px]'),
        visible ? 'opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <div className="rotate-[-0.6deg] px-5 py-4 text-kraft-800/60">
        <div className="hand mb-2 text-[26px] leading-none font-bold text-kraft-800/50">{t('shortcuts')}</div>
        <div className={cn('grid gap-x-6 gap-y-1.5', compact ? 'grid-cols-2 text-[12px]' : 'grid-cols-3 text-[14px]')}>
          {(compact ? items.slice(0, 10) : items).map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="hand min-w-[52px] text-[19px] leading-none font-bold text-kraft-800/60">{snippetKey(s)}</span>
              <span className="[&_.katex]:text-kraft-800/70">
                <Tex tex={s.label} />
              </span>
              {!compact && <span className="text-[11.5px] text-kraft-800/45">{t(hintKey(s.id))}</span>}
            </div>
          ))}
        </div>
        {compact && (
          <div className="mt-2 border-t border-dashed border-kraft-800/20 pt-1.5 text-[11.5px] text-kraft-800/55">
            {t('scNoAlt')}
          </div>
        )}
        {!compact && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-dashed border-kraft-800/20 pt-2 text-[12.5px]">
            {extra.map((e) => (
              <span key={e.k}>
                <b className="hand text-[18px] text-kraft-800/60">{e.k}</b> {e.d}
              </span>
            ))}
            <span>
              <b className="hand text-[18px] text-kraft-800/60">{MOD} Z</b> {t('undo')}
            </span>
            <span className="text-kraft-800/45">{t('scAlso')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
