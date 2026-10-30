import { BookOpen, Maximize, Minus, MoreHorizontal, Plus, Redo2, Settings2, Trash2, Undo2 } from 'lucide-react'
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
  onSample: (text: string) => void
  penDetected: boolean
}

function IconBtn({ label, onClick, disabled, children, compact }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; compact: boolean }) {
  const b = (
    <button onClick={onClick} disabled={disabled} aria-label={label} className={cn('grid place-items-center rounded-xl text-kraft-800 transition hover:bg-kraft-200/80 disabled:opacity-35', compact ? 'size-11' : 'size-9')}>
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

function SampleList({ onSample }: { onSample: (t: string) => void }) {
  return (
    <div className="flex max-h-[60dvh] flex-col gap-0.5 overflow-y-auto">
      <div className="px-1 pb-1 text-[11px] font-semibold tracking-widest text-kraft-600">示例 · 点一下贴到页面中央</div>
      {SAMPLES.map((s) => (
        <button key={s.title} onClick={() => onSample(s.text)} className="rounded-lg px-2 py-1.5 text-left hover:bg-kraft-200">
          <div className="text-[13px] font-medium text-kraft-800">{s.title}</div>
          <div className="font-mono text-[11px] whitespace-pre-line text-kraft-600">{s.text}</div>
          <div className="text-[11px] text-kraft-500">{s.note}</div>
        </button>
      ))}
    </div>
  )
}

export function TopBar(p: Props) {
  const zoom = `${Math.round(p.scale * 100)}%`
  return (
    <>
      <div className="pointer-events-none fixed top-3 left-3 z-40 flex items-center gap-2" data-no-board>
        <div className="kraft-panel pointer-events-auto flex items-center gap-2 rounded-2xl py-1.5 pr-3 pl-2">
          <div className="grid size-8 place-items-center rounded-lg bg-kraft-700 font-serif text-[17px] text-kraft-50 italic">∫</div>
          <div className="leading-none">
            <div className="hand text-[22px] font-bold text-kraft-800">数手账</div>
            <div className="text-[9.5px] tracking-widest text-kraft-600">MATHSCRAP · 演示版</div>
          </div>
          {p.penDetected && !p.compact && <span className="ml-1 rounded-full bg-ink-green/85 px-2 py-0.5 text-[10px] text-kraft-50">已识别手写笔 · 手指平移</span>}
        </div>
      </div>

      <div className="kraft-panel fixed top-3 right-3 z-40 flex items-center gap-0.5 rounded-2xl p-1" data-no-board>
        <IconBtn label={`撤销 (${MOD} Z)`} onClick={p.onUndo} disabled={!p.canUndo} compact={p.compact}>
          <Undo2 className="size-[18px]" />
        </IconBtn>
        <IconBtn label={`重做 (${MOD} Shift Z)`} onClick={p.onRedo} disabled={!p.canRedo} compact={p.compact}>
          <Redo2 className="size-[18px]" />
        </IconBtn>
        {!p.compact ? (
          <>
            <div className="mx-1 h-6 w-px bg-kraft-600/25" />
            <IconBtn label="缩小" onClick={() => p.onZoom(1 / 1.2)} compact={false}>
              <Minus className="size-4" />
            </IconBtn>
            <button onClick={p.onFit} className="h-9 min-w-14 rounded-xl px-1.5 text-[12.5px] font-medium text-kraft-800 tabular-nums hover:bg-kraft-200/80" title="适配全部内容">
              {zoom}
            </button>
            <IconBtn label="放大" onClick={() => p.onZoom(1.2)} compact={false}>
              <Plus className="size-4" />
            </IconBtn>
            <div className="mx-1 h-6 w-px bg-kraft-600/25" />
            <Popover>
              <PopoverTrigger className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] text-kraft-800 hover:bg-kraft-200/80">
                <BookOpen className="size-4" /> 示例
              </PopoverTrigger>
              <PopoverContent align="end" className="kraft-panel w-80 bg-transparent">
                <SampleList onSample={p.onSample} />
              </PopoverContent>
            </Popover>
            <IconBtn label="清空页面" onClick={p.onClear} compact={false}>
              <Trash2 className="size-[18px]" />
            </IconBtn>
            <IconBtn label="设置 · AI 接口预留" onClick={p.onSettings} compact={false}>
              <Settings2 className="size-[18px]" />
            </IconBtn>
          </>
        ) : (
          <Popover>
            <PopoverTrigger className="grid size-11 place-items-center rounded-xl text-kraft-800 hover:bg-kraft-200/80" aria-label="更多">
              <MoreHorizontal className="size-5" />
            </PopoverTrigger>
            <PopoverContent align="end" className="kraft-panel w-[min(340px,calc(100vw-24px))] bg-transparent">
              <div className="flex items-center justify-between gap-1 border-b border-kraft-600/20 pb-2">
                <button onClick={() => p.onZoom(1 / 1.2)} className="grid size-11 place-items-center rounded-xl hover:bg-kraft-200" aria-label="缩小">
                  <Minus className="size-4" />
                </button>
                <button onClick={p.onFit} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] hover:bg-kraft-200">
                  <Maximize className="size-4" /> {zoom} · 适配
                </button>
                <button onClick={() => p.onZoom(1.2)} className="grid size-11 place-items-center rounded-xl hover:bg-kraft-200" aria-label="放大">
                  <Plus className="size-4" />
                </button>
              </div>
              <SampleList onSample={p.onSample} />
              <div className="grid grid-cols-2 gap-1 border-t border-kraft-600/20 pt-2">
                <button onClick={p.onSettings} className="flex h-11 items-center justify-center gap-1.5 rounded-xl text-[13px] hover:bg-kraft-200">
                  <Settings2 className="size-4" /> 设置
                </button>
                <button onClick={p.onClear} className="flex h-11 items-center justify-center gap-1.5 rounded-xl text-[13px] text-ink-red hover:bg-kraft-200">
                  <Trash2 className="size-4" /> 清空
                </button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </>
  )
}
