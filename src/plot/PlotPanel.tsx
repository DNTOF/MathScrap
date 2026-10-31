import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import type { Card } from '@/board/types'
import { PlotPane } from './PlotPane'

interface Props {
  cards: Card[]
  open: boolean
  /** formula the plot was opened from — decides plane vs space when the sheet has both */
  focusId: string | null
  onClose: () => void
}

/**
 * The full-screen view of the sheet's shared coordinate system. The same PlotPane also lives
 * docked beside the sheet; the modal is the "full focus" variant.
 */
export function PlotPanel({ cards, open, focusId, onClose }: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-kraft-800/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup
          className="kraft-panel fixed inset-0 z-50 flex flex-col overflow-hidden outline-none transition-all data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 sm:inset-3 sm:rounded-3xl lg:inset-6"
          data-no-board
        >
          <PlotPane cards={cards} focusId={focusId} variant="modal" />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
