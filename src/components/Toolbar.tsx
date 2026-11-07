import { ChevronUp, Eraser, Highlighter, MousePointer2, PenLine, ScanText, Sigma } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PenSettings } from '@/board/Board'
import { INK_COLORS, type PenStyle, type Tool } from '@/board/types'
import { useI18n } from '@/i18n/useI18n'
import { cn } from '@/lib/utils'

const STYLE_IDS: PenStyle[] = ['ink', 'pencil', 'dashed', 'dotted', 'washi']

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
}

function ToolButton({ active, onClick, label, shortcut, children, compact }: { active?: boolean; onClick: () => void; label: string; shortcut?: string; children: React.ReactNode; compact: boolean }) {
  const btn = (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn('grid place-items-center rounded-full transition', compact ? 'size-11' : 'size-10', active ? 'bg-kraft-800 text-kraft-50' : 'text-kraft-800 hover:bg-kraft-800/10')}
    >
      {children}
    </button>
  )
  if (compact) return btn
  return (
    <Tooltip>
      <TooltipTrigger render={btn} />
      <TooltipContent side="top">
        {label}
        {shortcut && <span className="ml-1.5 opacity-70">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const STYLE_KEY = { ink: 'penInk', pencil: 'penPencil', dashed: 'penDashed', dotted: 'penDotted', washi: 'penWashi' } as const
const INK_KEY: Record<string, 'inkBlack' | 'inkRed' | 'inkBlue' | 'inkGreen' | 'inkYellow' | 'inkWhite'> = {
  '#2b2118': 'inkBlack',
  '#9b3b2a': 'inkRed',
  '#2f4a6d': 'inkBlue',
  '#4d6b3c': 'inkGreen',
  '#b9852a': 'inkYellow',
  '#f6eedd': 'inkWhite',
}

function PenOptions({ pen, setPen }: { pen: PenSettings; setPen: (p: PenSettings) => void }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {INK_COLORS.map((c) => (
          <button key={c.value} onClick={() => setPen({ ...pen, color: c.value })} title={t(INK_KEY[c.value])} aria-label={t(INK_KEY[c.value])} className={cn('size-8 rounded-full border-2 transition', pen.color === c.value ? 'scale-110 border-kraft-800' : 'border-kraft-50/70')} style={{ background: c.value }} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-0.5">
        {STYLE_IDS.map((id) => (
          <button key={id} onClick={() => setPen({ ...pen, style: id })} className={cn('flex h-9 items-center justify-between rounded-lg px-2.5 text-[13px] transition', pen.style === id ? 'bg-kraft-800 text-kraft-50' : 'hover:bg-kraft-800/10')}>
            <span>{t(STYLE_KEY[id])}</span>
            <StylePreview style={id} color={pen.style === id ? '#f5ead8' : pen.color} />
          </button>
        ))}
      </div>
      <div>
        <div className="mb-2 flex justify-between text-[11px] text-kraft-700">
          <span>{t('width')}</span>
          <span>{pen.width}px</span>
        </div>
        <Slider min={1} max={12} step={0.5} value={[pen.width]} onValueChange={(v) => setPen({ ...pen, width: Array.isArray(v) ? v[0] : (v as number) })} />
      </div>
    </div>
  )
}

/** One floating pill at the bottom of the sheet, Freeform-style. */
export function Toolbar({ tool, setTool, pen, setPen, compact, onRecognize }: Props) {
  const { t } = useI18n()
  const icon = compact ? 'size-5.5' : 'size-5'
  const sep = <div className="mx-0.5 h-6 w-px bg-kraft-800/15" />
  return (
    <nav
      className={cn(
        'paper-chrome absolute left-1/2 z-40 flex max-w-[calc(100%-env(safe-area-inset-left)-env(safe-area-inset-right)-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-full p-1',
        compact ? 'bottom-[max(12px,env(safe-area-inset-bottom))]' : 'bottom-[max(1.25rem,env(safe-area-inset-bottom))]',
      )}
      data-no-board
      aria-label={t('tools')}
    >
      <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} label={t('pen')} shortcut="P" compact={compact}>
        <span className="relative">
          <PenLine className={icon} />
          <span className="absolute -right-1 -bottom-1 size-2.5 rounded-full border border-kraft-50" style={{ background: pen.color }} />
        </span>
      </ToolButton>
      <Popover>
        <PopoverTrigger className="grid h-10 w-5 place-items-center rounded-full text-kraft-700 hover:bg-kraft-800/10" aria-label={t('penStyle')}>
          <ChevronUp className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent side="top" className="paper-chrome w-64 bg-transparent">
          <PenOptions pen={pen} setPen={setPen} />
        </PopoverContent>
      </Popover>
      <ToolButton active={tool === 'marker'} onClick={() => setTool('marker')} label={t('marker')} shortcut="M" compact={compact}>
        <Highlighter className={icon} />
      </ToolButton>
      <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} label={t('eraser')} shortcut="E" compact={compact}>
        <Eraser className={icon} />
      </ToolButton>
      {sep}
      <ToolButton active={tool === 'select'} onClick={() => setTool('select')} label={t('select')} shortcut="V" compact={compact}>
        <MousePointer2 className={icon} />
      </ToolButton>
      <ToolButton active={tool === 'type'} onClick={() => setTool('type')} label={t('typeTool')} shortcut="T" compact={compact}>
        <Sigma className={icon} />
      </ToolButton>
      <ToolButton onClick={onRecognize} label={t('recognize')} shortcut="R" compact={compact}>
        <ScanText className={icon} />
      </ToolButton>
    </nav>
  )
}
