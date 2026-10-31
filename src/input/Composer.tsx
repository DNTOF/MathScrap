import { Check, X } from 'lucide-react'
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { summarizeCard } from '@/math/scene'
import { MathPalette } from './MathPalette'
import { applySnippet, matchSnippet, nextPlaceholder, type Snippet } from './snippets'

interface Props {
  value: string
  onChange: (v: string) => void
  /** commit what was written (an emptied edit erases the formula) */
  onSubmit: () => void
  onCancel: () => void
  editing: boolean
  onFocusChange: (f: boolean) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  compact: boolean
  open: boolean
  /** screen position of the writing spot on the sheet */
  anchor: { left: number; top: number } | null
}

const TRY = ['y = x^2 - 2', 'x^2 + y^2 = 4', 'x^2 + 2x + 1 = 0', '△ABC: a=3, b=4, C=90°', 'z = sin(x)cos(y)']

export function insertSnippet(el: HTMLTextAreaElement | null, value: string, onChange: (v: string) => void, s: Snippet) {
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  const r = applySnippet(value, start, end, s)
  onChange(r.value)
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(r.selStart, r.selEnd)
  })
}

/**
 * Writing a formula straight onto the paper: a caret where you tapped, the ink preview
 * right beneath it, and nothing else. Clicking away writes it down, like a Freeform text box.
 */
export function Composer({ value, onChange, onSubmit, onCancel, editing, onFocusChange, textareaRef, compact, open, anchor }: Props) {
  const deferred = useDeferredValue(value)
  const summary = deferred.trim() ? summarizeCard(deferred) : null
  const hasHole = value.includes('□')
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 420, h: 120 })
  /** set once Enter / Esc / a button finished this session, so the following blur is a no-op */
  const settled = useRef(false)
  const submit = () => {
    settled.current = true
    onSubmit()
  }
  const cancel = () => {
    settled.current = true
    onCancel()
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value, textareaRef, open])

  useEffect(() => {
    if (!open) return
    settled.current = false
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [open, anchor?.left, anchor?.top, editing, textareaRef])

  useLayoutEffect(() => {
    const el = boxRef.current
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight })
  }, [deferred, open])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const sn = matchSnippet(e)
    if (sn) {
      e.preventDefault()
      insertSnippet(el, value, onChange, sn)
      return
    }
    if (e.key === 'Tab') {
      const i = nextPlaceholder(value, el.selectionEnd)
      if (i >= 0) {
        e.preventDefault()
        el.setSelectionRange(i, i + 1)
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!hasHole) submit()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  const onBlur = () => {
    onFocusChange(false)
    // switching windows is not "clicking away"
    if (settled.current || !document.hasFocus() || !open || hasHole) return
    if (value.trim() || editing) submit()
    else cancel()
  }

  if (!open) return null

  const keep = (e: React.SyntheticEvent) => e.preventDefault()

  const preview = summary && (
    <div className="ink-formula flex flex-col gap-0.5 text-[24px] leading-snug">
      {summary.lines.map((l, i) => (
        <div key={i} className={cn('whitespace-nowrap', l.error && 'ink-error')}>
          <Tex tex={l.latex} />
          {l.error && <div className="hand text-[15px] leading-tight whitespace-normal text-ink-red/90">{l.error}</div>}
        </div>
      ))}
    </div>
  )

  const field = (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={() => onFocusChange(true)}
      onBlur={onBlur}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      enterKeyHint="done"
      aria-label="在纸上写公式"
      placeholder={editing ? '改写这个式子…' : '写一个式子…'}
      className="min-h-9 w-full resize-none bg-transparent py-1.5 font-mono text-[17px] leading-6 text-ink outline-none placeholder:font-sans placeholder:text-[15px] placeholder:text-kraft-800/45"
    />
  )

  const tips = !value.trim() && !editing && (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] text-kraft-800/60">
      <span>试试</span>
      {TRY.map((t) => (
        <button key={t} onPointerDown={keep} onMouseDown={keep} onClick={() => onChange(t)} className="rounded-md px-1 font-mono text-kraft-800/80 underline decoration-kraft-800/25 underline-offset-2 hover:bg-kraft-800/8">
          {t}
        </button>
      ))}
    </div>
  )

  const footer = (
    <div className="text-[11px] text-kraft-800/55">{hasHole ? <span className="text-ink-red">还有 □ 没填，按 Tab 跳过去</span> : 'Enter 写上 · Shift+Enter 换行加条件 · Esc 放弃'}</div>
  )

  if (compact) {
    return (
      <div className="paper-chrome absolute inset-x-2 bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2 rounded-3xl px-3 pt-2 pb-2.5" data-no-board>
        {preview && <div className="max-h-[26dvh] overflow-auto">{preview}</div>}
        <div className="flex items-end gap-1.5 border-b border-dashed border-kraft-800/30">
          {field}
          <button onPointerDown={keep} onMouseDown={keep} onClick={cancel} className="touch-target grid size-9 shrink-0 place-items-center rounded-full text-kraft-700" aria-label="放弃">
            <X className="size-4.5" />
          </button>
          <button onPointerDown={keep} onMouseDown={keep} onClick={submit} disabled={hasHole || (!value.trim() && !editing)} className="touch-target mb-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-kraft-800 text-kraft-50 disabled:opacity-35" aria-label="写上">
            <Check className="size-4.5" />
          </button>
        </div>
        {tips}
        <MathPalette layout="row" onInsert={(s) => insertSnippet(textareaRef.current, value, onChange, s)} />
      </div>
    )
  }

  const a = anchor ?? { left: window.innerWidth / 2 - 200, top: window.innerHeight / 3 }
  const left = Math.max(16, Math.min(a.left, window.innerWidth - size.w - 300))
  const top = Math.max(64, Math.min(a.top, window.innerHeight - size.h - 96))

  return (
    <div ref={boxRef} className="absolute z-30 flex w-[min(460px,calc(100vw-340px))] flex-col gap-1.5 animate-in fade-in" style={{ left: left - 10, top: top - 6 }} data-no-board>
      <div className="rounded-xl border border-dashed border-kraft-800/40 bg-kraft-50/15 px-2.5 py-1">{field}</div>
      <div className="flex flex-col gap-1.5 px-2.5">
        {preview}
        {tips}
        {footer}
      </div>
    </div>
  )
}
