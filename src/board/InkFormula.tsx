import { LineChart, Pencil, Trash2 } from 'lucide-react'
import { memo, useRef } from 'react'
import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { summarizeCard } from '@/math/scene'
import type { Card } from './types'

interface Props {
  card: Card
  scale: number
  /** Pen-like pointers write over the formula instead of grabbing it. */
  inkFirst: (e: React.PointerEvent) => boolean
  movable: boolean
  selected: boolean
  hidden: boolean
  onSelect: (id: string) => void
  onDragStart: (id: string) => void
  onDrag: (id: string, dx: number, dy: number) => void
  onDragEnd: (id: string) => void
  onPlot: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

/** A formula written straight onto the kraft sheet — no card, just ink. */
export const InkFormula = memo(function InkFormula({ card, scale, inkFirst, movable, selected, hidden, onSelect, onDragStart, onDrag, onDragEnd, onPlot, onEdit, onDelete }: Props) {
  const summary = summarizeCard(card.text)
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null)

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (inkFirst(e)) return
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

  const action = 'grid size-8 place-items-center rounded-full text-kraft-800 transition hover:bg-kraft-800/10'

  return (
    <div
      data-formula={card.id}
      className={cn('group absolute select-none', hidden && 'invisible')}
      style={{ left: card.x, top: card.y, cursor: movable ? 'grab' : undefined }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div
        className={cn(
          'ink-formula -mx-2.5 -my-1.5 rounded-xl border border-transparent px-2.5 py-1.5 text-[24px] leading-snug transition-colors',
          selected ? 'border-dashed border-kraft-800/45 bg-kraft-50/10' : movable && 'group-hover:border-kraft-800/20',
        )}
      >
        {summary.lines.map((l, i) => (
          <div key={i} className={cn('whitespace-nowrap', l.error && 'ink-error')}>
            <Tex tex={l.latex} />
            {l.error && <div className="hand mt-0.5 text-[15px] leading-tight whitespace-normal text-ink-red/90">{l.error}</div>}
          </div>
        ))}
      </div>
      {selected && (
        <div
          className="paper-chrome absolute bottom-full left-0 mb-2 flex origin-bottom-left items-center gap-0.5 rounded-full p-0.5"
          style={{ transform: `scale(${1 / scale})` }}
          onPointerDown={(e) => e.stopPropagation()}
          data-no-board
        >
          <button className={action} onClick={() => onEdit(card.id)} title="改写 (双击)" aria-label="改写">
            <Pencil className="size-4" />
          </button>
          {summary.plottable && (
            <button className={action} onClick={() => onPlot(card.id)} title="在坐标系里看 (Enter)" aria-label="坐标系">
              <LineChart className="size-4" />
            </button>
          )}
          <button className={cn(action, 'text-ink-red')} onClick={() => onDelete(card.id)} title="擦掉 (Delete)" aria-label="删除">
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
})
