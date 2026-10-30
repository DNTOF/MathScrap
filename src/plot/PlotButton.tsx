import { LineChart } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The corner button: opens the sheet's shared coordinate system. */
export function PlotButton({ count, compact, onOpen }: { count: number; compact: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="打开坐标系"
      title="所有式子画进同一个坐标系 (G)"
      data-no-board
      className={cn(
        'paper-chrome fixed z-40 flex items-center gap-2 rounded-full text-kraft-800 transition hover:-translate-y-0.5 active:translate-y-0',
        compact ? 'right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] h-12 px-3.5' : 'right-5 bottom-5 h-12 px-4',
        count ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      <LineChart className="size-5" />
      <span className="text-[13.5px] font-medium">坐标系</span>
      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-kraft-800 px-1 text-[11px] font-semibold text-kraft-50 tabular-nums">{count}</span>
    </button>
  )
}
