import { Maximize, Minus, MoreHorizontal, Plus, Redo2, Settings2, Trash2, Undo2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SAMPLES } from '@/board/samples'
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
  const zoom = `${Math.round(p.scale * 100)}%`
  const row = 'flex h-10 items-center gap-2 rounded-xl px-2.5 text-[13px] text-kraft-800 hover:bg-kraft-800/10'
  return (
    <>
      <div className="paper-chrome absolute top-3 right-3 z-40 flex items-center gap-0.5 rounded-full p-1" data-no-board>
        <IconBtn label={`撤销 (${MOD} Z)`} onClick={p.onUndo} disabled={!p.canUndo} compact={p.compact}>
          <Undo2 className="size-[18px]" />
        </IconBtn>
        <IconBtn label={`重做 (${MOD} Shift Z)`} onClick={p.onRedo} disabled={!p.canRedo} compact={p.compact}>
          <Redo2 className="size-[18px]" />
        </IconBtn>
        <Popover>
          <PopoverTrigger className={cn('grid place-items-center rounded-full text-kraft-800 hover:bg-kraft-800/10', p.compact ? 'size-11' : 'size-9')} aria-label="更多">
            <MoreHorizontal className="size-5" />
          </PopoverTrigger>
          <PopoverContent align="end" className="paper-chrome w-[min(330px,calc(100vw-24px))] gap-0 bg-transparent p-1.5">
            <div className="px-2.5 pt-1 pb-1.5 text-[12px] font-semibold tracking-tight text-kraft-800/70">MathScrap</div>
            <div className="flex items-center gap-1 pb-1.5">
              <button onClick={() => p.onZoom(1 / 1.2)} className="grid size-10 place-items-center rounded-xl hover:bg-kraft-800/10" aria-label="缩小">
                <Minus className="size-4" />
              </button>
              <button onClick={p.onFit} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] tabular-nums hover:bg-kraft-800/10" title="把写过的内容都放进视野">
                <Maximize className="size-4" /> {zoom}
              </button>
              <button onClick={() => p.onZoom(1.2)} className="grid size-10 place-items-center rounded-xl hover:bg-kraft-800/10" aria-label="放大">
                <Plus className="size-4" />
              </button>
            </div>
            <div className="border-t border-kraft-800/10 pt-1.5">
              <div className="px-2.5 pb-1 text-[11px] text-kraft-700">写几个例子到纸上</div>
              <div className="flex max-h-[46dvh] flex-col overflow-y-auto">
                {SAMPLES.map((s) => (
                  <button key={s.title} onClick={() => p.onSample(s.blocks)} className="rounded-xl px-2.5 py-1.5 text-left hover:bg-kraft-800/10">
                    <div className="text-[13px] text-kraft-800">{s.title}</div>
                    <div className="truncate font-mono text-[11px] text-kraft-700/80">{s.blocks.join('   ·   ')}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1 border-t border-kraft-800/10 pt-1.5">
              <button onClick={p.onSettings} className={row}>
                <Settings2 className="size-4" /> 设置
              </button>
              <button onClick={p.onClear} className={cn(row, 'text-ink-red')}>
                <Trash2 className="size-4" /> 清空这页
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}
