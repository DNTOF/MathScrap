import { Eraser, Hand, Highlighter, PenLine, ScanText, Sigma } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PenSettings } from '@/board/Board'
import { INK_COLORS, type PenStyle, type Tool } from '@/board/types'
import { cn } from '@/lib/utils'

const STYLES: { id: PenStyle; name: string }[] = [
  { id: 'ink', name: '钢笔（压感）' },
  { id: 'pencil', name: '铅笔颗粒' },
  { id: 'dashed', name: '虚线' },
  { id: 'dotted', name: '点线' },
  { id: 'washi', name: '和纸胶带' },
]

function StylePreview({ style, color }: { style: PenStyle; color: string }) {
  const d = 'M4 14 C 14 4, 24 4, 34 12 S 54 20, 60 8'
  return (
    <svg viewBox="0 0 64 22" className="h-5 w-16">
      {style === 'ink' && <path d={d} stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />}
      {style === 'pencil' && <path d={d} stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.8" strokeDasharray="6 1 3 1" />}
      {style === 'dashed' && <path d={d} stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeDasharray="7 5" />}
      {style === 'dotted' && <path d={d} stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="0 6" />}
      {style === 'washi' && (
        <>
          <path d={d} stroke={color} strokeWidth="9" fill="none" opacity="0.65" />
          <path d={d} stroke="rgba(255,250,240,0.6)" strokeWidth="9" fill="none" strokeDasharray="2 4" />
        </>
      )}
    </svg>
  )
}

interface Props {
  tool: Tool
  setTool: (t: Tool) => void
  pen: PenSettings
  setPen: (p: PenSettings) => void
  compact: boolean
  onRecognize: () => void
  onOpenComposer: () => void
}

function ToolButton({ active, onClick, label, shortcut, children, compact }: { active?: boolean; onClick: () => void; label: string; shortcut?: string; children: React.ReactNode; compact: boolean }) {
  const btn = (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'grid place-items-center rounded-xl transition',
        compact ? 'size-12' : 'size-11',
        active ? 'bg-kraft-700 text-kraft-50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.25)]' : 'text-kraft-800 hover:bg-kraft-200/80',
      )}
    >
      {children}
    </button>
  )
  if (compact) return btn
  return (
    <Tooltip>
      <TooltipTrigger render={btn} />
      <TooltipContent side="right">
        {label}
        {shortcut && <span className="ml-1.5 opacity-70">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function PenOptions({ pen, setPen }: { pen: PenSettings; setPen: (p: PenSettings) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-widest text-kraft-600">笔触</div>
        <div className="grid grid-cols-1 gap-1">
          {STYLES.map((s) => (
            <button key={s.id} onClick={() => setPen({ ...pen, style: s.id })} className={cn('flex h-10 items-center justify-between rounded-lg px-2.5 text-[13px] transition', pen.style === s.id ? 'bg-kraft-700 text-kraft-50' : 'hover:bg-kraft-200')}>
              <span>{s.name}</span>
              <StylePreview style={s.id} color={pen.style === s.id ? '#f5ead8' : pen.color} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-widest text-kraft-600">颜色</div>
        <div className="flex flex-wrap gap-2">
          {INK_COLORS.map((c) => (
            <button key={c.value} onClick={() => setPen({ ...pen, color: c.value })} title={c.name} aria-label={c.name} className={cn('size-9 rounded-full border-2 transition', pen.color === c.value ? 'scale-110 border-kraft-800' : 'border-kraft-50/70')} style={{ background: c.value }} />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 flex justify-between text-[11px] font-semibold tracking-widest text-kraft-600">
          <span>粗细</span>
          <span>{pen.width}px</span>
        </div>
        <Slider min={1} max={12} step={0.5} value={[pen.width]} onValueChange={(v) => setPen({ ...pen, width: Array.isArray(v) ? v[0] : (v as number) })} />
      </div>
    </div>
  )
}

export function Toolbar({ tool, setTool, pen, setPen, compact, onRecognize, onOpenComposer }: Props) {
  const iconCls = compact ? 'size-5.5' : 'size-5'
  const penBtn = (
    <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} label="笔" shortcut="P" compact={compact}>
      <span className="relative">
        <PenLine className={iconCls} />
        <span className="absolute -right-1 -bottom-1 size-2.5 rounded-full border border-kraft-50" style={{ background: pen.color }} />
      </span>
    </ToolButton>
  )

  const items = (
    <>
      <Popover>
        <div className="flex items-center" onClickCapture={() => setTool('pen')}>
          {penBtn}
        </div>
        <PopoverTrigger className={cn('rounded-md text-[10px] text-kraft-700 hover:bg-kraft-200', compact ? 'h-12 px-0.5' : 'h-5 w-11')} aria-label="笔触设置">
          {compact ? '▾' : '笔触 ▾'}
        </PopoverTrigger>
        <PopoverContent side={compact ? 'top' : 'right'} className="kraft-panel w-64 bg-transparent">
          <PenOptions pen={pen} setPen={setPen} />
        </PopoverContent>
      </Popover>
      <ToolButton active={tool === 'marker'} onClick={() => setTool('marker')} label="荧光笔" shortcut="M" compact={compact}>
        <Highlighter className={iconCls} />
      </ToolButton>
      <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} label="橡皮（整笔擦除）" shortcut="E" compact={compact}>
        <Eraser className={iconCls} />
      </ToolButton>
      <ToolButton active={tool === 'hand'} onClick={() => setTool('hand')} label="抓手平移（或按住空格）" shortcut="H" compact={compact}>
        <Hand className={iconCls} />
      </ToolButton>
      {!compact && <div className="my-1 h-px w-8 bg-kraft-600/25" />}
      {!compact &&
        INK_COLORS.slice(0, 4).map((c) => (
          <button key={c.value} onClick={() => setPen({ ...pen, color: c.value })} aria-label={c.name} title={c.name} className={cn('size-6 rounded-full border-2 transition', pen.color === c.value ? 'scale-110 border-kraft-800' : 'border-kraft-50/70 hover:scale-105')} style={{ background: c.value }} />
        ))}
      {!compact && <div className="my-1 h-px w-8 bg-kraft-600/25" />}
      <ToolButton onClick={onRecognize} label="把手写转成公式（演示 OCR）" shortcut="R" compact={compact}>
        <ScanText className={iconCls} />
      </ToolButton>
    </>
  )

  if (compact) {
    return (
      <nav className="kraft-panel fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-1 rounded-t-2xl px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]" data-no-board>
        <div className="flex items-center gap-0.5">{items}</div>
        <button onClick={onOpenComposer} className="flex h-12 items-center gap-1.5 rounded-xl bg-kraft-700 px-4 text-[14px] font-medium text-kraft-50 shadow-md active:bg-kraft-800" aria-label="输入公式">
          <Sigma className="size-5" />
          公式
        </button>
      </nav>
    )
  }
  return (
    <nav className="kraft-panel fixed top-1/2 left-3 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl p-1.5" data-no-board>
      {items}
    </nav>
  )
}
