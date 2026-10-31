import { Check, Loader2, RefreshCw, X } from 'lucide-react'
import { useMemo } from 'react'
import type { Stroke, View } from '@/board/types'
import { Tex } from '@/components/Tex'
import { candidateLatex } from './show'

export interface InkChipData {
  id: string
  strokes: Stroke[]
  /** world coordinates where the chip floats (just below the ink) */
  at: { x: number; y: number }
  cands: { text: string; confidence: number }[] | null
  pick: number
}

/**
 * The on-paper recognition chip: settled handwriting raises a small kraft pill with the best
 * candidate formula. One tap writes it onto the sheet (and into the live plot); cycling walks
 * through the other candidates; dismissing leaves the ink untouched.
 */
export function InkChip({ chip, view, onAccept, onDismiss, onCycle }: { chip: InkChipData; view: View; onAccept: () => void; onDismiss: () => void; onCycle: () => void }) {
  const cands = chip.cands
  const waiting = cands === null
  const cand = cands?.[chip.pick] ?? null
  const latex = useMemo(() => (cand ? candidateLatex(cand.text) : ''), [cand])
  const left = chip.at.x * view.scale + view.x
  const top = chip.at.y * view.scale + view.y
  return (
    <div
      className="paper-chrome absolute z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5"
      style={{ left, top, maxWidth: 'min(92%, 420px)' }}
      data-no-board
      data-ink-chip=""
      data-ink-unknown={waiting || cand ? undefined : ''}
      role="group"
      aria-label="手写识别候选"
    >
      {waiting ? (
        <span className="flex items-center gap-1.5 pr-1 text-[12px] whitespace-nowrap text-kraft-700">
          <Loader2 className="size-3.5 animate-spin" /> 正在识别笔迹…
        </span>
      ) : !cand ? (
        <span className="pr-1 text-[12.5px] whitespace-nowrap text-kraft-700">没认出来</span>
      ) : (
        <>
          <span className="max-w-[240px] overflow-hidden text-[15px] text-ellipsis whitespace-nowrap">
            <Tex tex={latex} />
          </span>
          <span className="shrink-0 text-[10px] text-kraft-600 tabular-nums">{Math.round(cand.confidence * 100)}%</span>
        </>
      )}
      <button onClick={onAccept} disabled={waiting || !cand} aria-label="写成公式" title="写成公式" className="touch-target grid size-7 shrink-0 place-items-center rounded-full bg-kraft-800 text-kraft-50 disabled:opacity-40">
        <Check className="size-4" />
      </button>
      <button onClick={onCycle} disabled={!chip.cands || chip.cands.length < 2} aria-label="换一个候选" title="换一个候选" className="touch-target grid size-7 shrink-0 place-items-center rounded-full text-kraft-700 hover:bg-kraft-800/10 disabled:opacity-40">
        <RefreshCw className="size-3.5" />
      </button>
      <button onClick={onDismiss} aria-label="忽略这条笔迹" title="忽略" className="touch-target grid size-7 shrink-0 place-items-center rounded-full text-kraft-700 hover:bg-kraft-800/10">
        <X className="size-4" />
      </button>
    </div>
  )
}
