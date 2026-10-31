import { LineChart } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The corner button: shows the sheet's shared coordinate system — docked beside the paper on
 * wide screens, full-screen on phones. Acts as a toggle when the pane is already open.
 */
export function PlotButton({ count, compact, open, onOpen }: { count: number; compact: boolean; open: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="打开坐标系"
      aria-pressed={open}
      title="所有式子画进同一个坐标系 (G)"
      data-no-board
      className={cn(
        'paper-chrome absolute z-40 flex items-center gap-2 rounded-full text-kraft-800 transition hover:-translate-y-0.5 active:translate-y-0',
        compact ? 'right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] h-12 px-3.5' : 'right-5 bottom-5 h-12 px-4',
        count ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        open && 'bg-kraft-800 text-kraft-50',
      )}
    >
      <LineChart className="size-5" />
      <span className="text-[13.5px] font-medium">坐标系</span>
      <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums', open ? 'bg-kraft-50 text-kraft-800' : 'bg-kraft-800 text-kraft-50')}>{count}</span>
    </button>
  )
}
