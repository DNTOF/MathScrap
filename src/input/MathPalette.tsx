import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n/useI18n'
import type { MessageKey } from '@/i18n/messages'
import { SNIPPETS, snippetKey, type Snippet } from './snippets'

const GROUP_KEY: Record<Snippet['group'], MessageKey> = { basic: 'groupBasic', func: 'groupFunc', struct: 'groupStruct', geo: 'groupGeo' }
const hintKey = (id: string) => (`hint${id[0].toUpperCase()}${id.slice(1)}`) as MessageKey

const GROUPS: { id: Snippet['group'] }[] = [{ id: 'basic' }, { id: 'func' }, { id: 'struct' }, { id: 'geo' }]

/** Pressing a key must not steal focus from the formula textarea. */
const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault()

export function MathPalette({ onInsert, layout }: { onInsert: (s: Snippet) => void; layout: 'panel' | 'row' }) {
  const { t } = useI18n()
  if (layout === 'row') {
    return (
      <div className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => onInsert(s)}
            className="grid h-11 min-w-11 shrink-0 place-items-center rounded-lg border border-kraft-600/25 bg-kraft-100 px-2 text-[15px] text-kraft-800 active:bg-kraft-200"
            aria-label={t(hintKey(s.id))}
          >
            <Tex tex={s.label} />
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="kraft-panel w-[244px] rounded-2xl p-3" data-no-board>
      <div className="hand mb-1 text-[22px] leading-none font-bold text-kraft-800">{t('palette')}</div>
      <p className="mb-2 text-[11px] leading-snug text-kraft-600">{t('paletteHelp')}</p>
      {GROUPS.map((g) => (
        <div key={g.id} className="mb-2 last:mb-0">
          <div className="mb-1 text-[10px] font-semibold tracking-widest text-kraft-500">{t(GROUP_KEY[g.id])}</div>
          <div className="grid grid-cols-4 gap-1">
            {SNIPPETS.filter((s) => s.group === g.id).map((s) => (
              <button
                key={s.id}
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => onInsert(s)}
                title={`${t(hintKey(s.id))}${s.code ? ` · ${snippetKey(s)}` : ''}`}
                className={cn('group/key relative grid h-11 place-items-center rounded-lg border border-kraft-600/20 bg-kraft-50/70 text-[14px] text-kraft-800 transition hover:-translate-y-px hover:bg-kraft-50 active:translate-y-0', s.id === 'tri' && 'col-span-2', s.id === 'vec3' && 'col-span-2', s.id === 'through' && 'col-span-2')}
              >
                <Tex tex={s.label} />
                {s.code && <span className="absolute right-1 bottom-0.5 text-[8.5px] text-kraft-500 opacity-0 transition group-hover/key:opacity-100">{snippetKey(s)}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
