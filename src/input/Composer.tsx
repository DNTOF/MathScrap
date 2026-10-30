import { CornerDownLeft, Sigma, Sparkles, X } from 'lucide-react'
import { useDeferredValue, useEffect, type RefObject } from 'react'
import { Tex } from '@/components/Tex'
import { cn } from '@/lib/utils'
import { SAMPLES } from '@/board/samples'
import { summarizeCard } from '@/math/scene'
import { MathPalette } from './MathPalette'
import { applySnippet, matchSnippet, nextPlaceholder, type Snippet } from './snippets'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  editing: boolean
  focused: boolean
  onFocusChange: (f: boolean) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  compact: boolean
  open: boolean
}

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

export function Composer({ value, onChange, onSubmit, onCancel, editing, focused, onFocusChange, textareaRef, compact, open }: Props) {
  const deferred = useDeferredValue(value)
  const summary = deferred.trim() ? summarizeCard(deferred) : null
  const hasHole = deferred.includes('□')

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value, textareaRef])

  useEffect(() => {
    if (open && compact) requestAnimationFrame(() => textareaRef.current?.focus())
  }, [open, compact, textareaRef])

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
      if (value.trim() && !value.includes('□')) onSubmit()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      el.blur()
    }
  }

  const expanded = focused || !!value.trim()
  if (compact && !open) return null

  return (
    <div className={cn('fixed z-30 flex flex-col gap-2', compact ? 'inset-x-2 bottom-[calc(76px+env(safe-area-inset-bottom))]' : 'bottom-4 left-1/2 w-[min(760px,calc(100vw-180px))] -translate-x-1/2')} data-no-board>
      {expanded && (
        <div className="kraft-panel max-h-[38dvh] overflow-y-auto rounded-2xl px-4 py-3">
          {summary ? (
            <>
              <div className="flex flex-col gap-1.5">
                {summary.lines.map((l, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <span className={cn('w-16 shrink-0 text-right text-[10.5px] font-medium', l.error ? 'text-ink-red' : 'text-kraft-600')}>{l.kind}</span>
                    <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden text-[18px] text-ink">
                      <Tex tex={l.latex} />
                      {l.error && <div className="text-[11.5px] text-ink-red">{l.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-kraft-600/15 pt-2 text-[12px] text-kraft-700">
                {hasHole ? (
                  <span className="text-ink-red">还有 □ 没填，按 Tab 跳过去</span>
                ) : (
                  <>
                    {summary.plottable && <span className="rounded-full bg-kraft-200 px-2 py-0.5">{summary.dim === 3 ? '将用空间坐标系 3D' : '将用平面坐标系 2D'}</span>}
                    {summary.factCount > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-ink-green/90 px-2 py-0.5 text-kraft-50">
                        <Sparkles className="size-3" />
                        可推出 {summary.factCount} 项
                      </span>
                    )}
                    <span className="ml-auto text-kraft-500">Enter 贴到页面 · Shift+Enter 换行加条件</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div>
              <div className="mb-1.5 text-[12px] text-kraft-600">直接打字就行（x^2、sqrt(x)、2x 都认识），或者点一个例子：</div>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLES.slice(0, compact ? 6 : 12).map((s) => (
                  <button
                    key={s.title}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => onChange(s.text)}
                    className="touch-target rounded-lg border border-kraft-600/20 bg-kraft-50/70 px-2 py-1 text-left text-[12px] text-kraft-800 hover:bg-kraft-50"
                    title={s.note}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="kraft-panel flex items-end gap-2 rounded-2xl p-2">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-kraft-700 text-kraft-50">
          <Sigma className="size-5" />
        </div>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="done"
          placeholder={editing ? '修改这张卡片…' : compact ? '写公式，例如 y = x^2 - 2' : '写公式或条件，回车贴到页面 · 例如 y = x^2 - 2 或 △ABC: a=3, b=4, C=90°   （按 / 聚焦）'}
          className="min-h-10 flex-1 resize-none bg-transparent py-2 font-mono text-[16px] leading-6 text-ink outline-none placeholder:font-sans placeholder:text-[13.5px] placeholder:text-kraft-600/80"
        />
        {(value || editing || compact) && (
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={onCancel}
            className="touch-target grid size-10 shrink-0 place-items-center rounded-xl text-kraft-700 hover:bg-kraft-200"
            aria-label="取消"
            title="取消 (Esc)"
          >
            <X className="size-4.5" />
          </button>
        )}
        <button
          onPointerDown={(e) => e.preventDefault()}
          onClick={onSubmit}
          disabled={!value.trim() || hasHole}
          className="touch-target flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-kraft-700 px-3.5 text-[13.5px] font-medium text-kraft-50 transition hover:bg-kraft-800 disabled:opacity-40"
        >
          <CornerDownLeft className="size-4" />
          {editing ? '更新' : '贴上'}
        </button>
      </div>
      {compact && <MathPalette layout="row" onInsert={(s) => insertSnippet(textareaRef.current, value, onChange, s)} />}
    </div>
  )
}
