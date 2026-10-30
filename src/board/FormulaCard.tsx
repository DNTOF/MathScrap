import { Box, LineChart, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { memo, useRef } from 'react'
import { Tex } from '@/components/Tex'
import { summarizeCard } from '@/math/scene'
import { cn } from '@/lib/utils'
import type { Card } from './types'

/** Invisible halo so small in-card buttons stay tappable when the board is zoomed out. */
const HIT = "relative after:absolute after:-inset-2 after:content-['']"

interface Props {
  card: Card
  scale: number
  drawing: boolean
  selected: boolean
  onSelect: (id: string) => void
  onDragStart: (id: string) => void
  onDrag: (id: string, dx: number, dy: number) => void
  onDragEnd: (id: string) => void
  onPlot: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

export const FormulaCard = memo(function FormulaCard({ card, scale, drawing, selected, onSelect, onDragStart, onDrag, onDragEnd, onPlot, onEdit, onDelete }: Props) {
  const summary = summarizeCard(card.text)
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null)

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }
    onSelect(card.id)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = (e.clientX - d.x) / scale
    const dy = (e.clientY - d.y) / scale
    if (!d.moved && Math.hypot(dx, dy) * scale < 4) return
    if (!d.moved) onDragStart(card.id)
    d.moved = true
    d.x = e.clientX
    d.y = e.clientY
    onDrag(card.id, dx, dy)
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (d.moved) onDragEnd(card.id)
    drag.current = null
  }

  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const hasError = summary.lines.some((l) => l.error)

  return (
    <div
      data-card
      className={cn('group absolute select-none', drawing && 'pointer-events-none')}
      style={{ left: card.x, top: card.y, transform: `rotate(${card.rot}deg)` }}
    >
      <div
        className={cn(
          'kraft-card relative min-w-[200px] max-w-[340px] rounded-[6px] px-4 pt-6 pb-11 text-ink transition-shadow',
          selected && 'ring-2 ring-kraft-600/50',
          !drawing && 'cursor-grab active:cursor-grabbing',
        )}
        onPointerDown={drawing ? undefined : down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => onEdit(card.id)}
      >
        {/* washi tape doubles as the drag handle, even while a pen tool is active */}
        <div
          className="washi pointer-events-auto absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 cursor-grab rounded-[2px] opacity-85 active:cursor-grabbing"
          style={{ backgroundColor: card.tape, transform: `translateX(-50%) rotate(${-card.rot * 1.8 - 2}deg)` }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          title="拖动卡片"
        />
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-kraft-600">
          <span>{summary.headline}</span>
          {summary.plottable && <span className="rounded-full bg-kraft-200/70 px-1.5 py-px text-[10px] text-kraft-700">{summary.dim === 3 ? '空间 3D' : '平面 2D'}</span>}
        </div>
        <div
          className={cn('pointer-events-auto absolute top-2.5 right-2 flex items-center gap-1 rounded-full bg-kraft-50/90 px-0.5 shadow-sm transition-opacity', selected ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100')}
          onPointerDown={stop}
        >
          <button className={cn(HIT, 'grid size-6 place-items-center rounded-full text-kraft-700 hover:bg-kraft-200')} onClick={() => onEdit(card.id)} title="编辑" aria-label="编辑">
            <Pencil className="size-3.5" />
          </button>
          <button className={cn(HIT, 'grid size-6 place-items-center rounded-full text-ink-red hover:bg-kraft-200')} onClick={() => onDelete(card.id)} title="删除" aria-label="删除">
            <Trash2 className="size-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-1.5 text-[17px] leading-snug">
          {summary.lines.map((l, i) => (
            <div key={i} className={cn('overflow-x-auto overflow-y-hidden', l.error && 'text-ink-red')}>
              <Tex tex={l.latex} />
              {l.error && <div className="mt-0.5 text-[11px] text-ink-red/90">{l.error}</div>}
            </div>
          ))}
        </div>

        <div className="pointer-events-auto absolute inset-x-2 bottom-2 flex items-end justify-between gap-2" onPointerDown={stop}>
          <div className="flex items-center gap-1">
            {summary.factCount > 0 && (
              <button
                className={cn(HIT, 'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-kraft-700/90 px-2.5 text-[11px] font-medium text-kraft-50 shadow-sm transition hover:bg-kraft-800')}
                onClick={() => onPlot(card.id)}
                title="查看所有推导结果"
              >
                <Sparkles className="size-3" />
                可推出 {summary.factCount} 项
              </button>
            )}
            {hasError && <span className="text-[11px] text-ink-red">需要修正</span>}
          </div>
          {summary.plottable && (
            <button
              className={cn(HIT, 'grid size-9 place-items-center rounded-full border border-kraft-600/30 bg-kraft-100 text-kraft-800 shadow-[0_3px_8px_-3px_rgba(60,35,15,0.6)] transition hover:-translate-y-0.5 hover:bg-kraft-50')}
              onClick={() => onPlot(card.id)}
              title={summary.dim === 3 ? '打开空间坐标系' : '打开平面坐标系'}
              aria-label="绘图"
            >
              {summary.dim === 3 ? <Box className="size-4.5" /> : <LineChart className="size-4.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
