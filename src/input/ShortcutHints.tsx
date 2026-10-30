import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { MOD, SNIPPETS, snippetKey } from './snippets'

/**
 * The cheat-sheet "pencilled" onto the kraft page while typing — pointer-transparent,
 * low contrast, so it reads like notes on the paper rather than UI chrome.
 */
export function ShortcutHints({ visible, compact, placement = 'top' }: { visible: boolean; compact: boolean; placement?: 'top' | 'bottom' }) {
  const items = SNIPPETS.filter((s) => s.code)
  const extra = [
    { k: 'Enter', d: '写上纸面' },
    { k: 'Shift Enter', d: '换行写下一个条件' },
    { k: 'Tab', d: '跳到下一个 □' },
    { k: 'Esc', d: '放弃' },
    { k: 'G', d: '所有式子 → 同一坐标系' },
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
        <div className="hand mb-2 text-[26px] leading-none font-bold text-kraft-800/50">边写边看 · 快捷键</div>
        <div className={cn('grid gap-x-6 gap-y-1.5', compact ? 'grid-cols-2 text-[12px]' : 'grid-cols-3 text-[14px]')}>
          {(compact ? items.slice(0, 10) : items).map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="hand min-w-[52px] text-[19px] leading-none font-bold text-kraft-800/60">{snippetKey(s)}</span>
              <span className="[&_.katex]:text-kraft-800/70">
                <Tex tex={s.label} />
              </span>
              {!compact && <span className="text-[11.5px] text-kraft-800/45">{s.hint}</span>}
            </div>
          ))}
        </div>
        {compact && (
          <div className="mt-2 border-t border-dashed border-kraft-800/20 pt-1.5 text-[11.5px] text-kraft-800/55">
            没有 Alt 键？直接打：x^2 · sqrt(x) · _|_ · // · 30° · Tab 跳 □
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
              <b className="hand text-[18px] text-kraft-800/60">{MOD} Z</b> 撤销
            </span>
            <span className="text-kraft-800/45">也可以直接打：x^2 · sqrt(x) · 2x · _|_ · // · 30°</span>
          </div>
        )}
      </div>
    </div>
  )
}
