import { Loader2, ScanText, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Tex } from '@/components/Tex'
import { StrokeDefs, StrokeShape, strokeBounds } from '@/board/strokes'
import type { Stroke } from '@/board/types'
import { cn } from '@/lib/utils'
import { insertSnippet } from '@/input/Composer'
import { matchSnippet, nextPlaceholder } from '@/input/snippets'
import { summarizeCard } from '@/math/scene'
import { mockRecognizer, type Candidate } from './recognizer'

interface Props {
  strokes: Stroke[] | null
  onClose: () => void
  onConfirm: (text: string, keepInk: boolean) => void
}

export function RecognizeDialog({ strokes, onClose, onConfirm }: Props) {
  const [cands, setCands] = useState<Candidate[] | null>(null)
  const [text, setText] = useState('')
  const [keep, setKeep] = useState(true)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!strokes) return
    setCands(null)
    setText('')
    mockRecognizer.recognize(strokes).then((c) => {
      setCands(c)
      setText(c[0]?.text ?? '')
    })
  }, [strokes])

  const box = useMemo(() => {
    if (!strokes?.length) return null
    const b = strokeBounds(strokes)
    const pad = 16
    return `${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}`
  }, [strokes])

  const summary = text.trim() ? summarizeCard(text) : null

  return (
    <Dialog open={!!strokes} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="kraft-panel max-h-[92dvh] overflow-y-auto bg-transparent sm:max-w-lg" data-no-board>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-kraft-800">
            <ScanText className="size-5" /> 手写 → 公式
          </DialogTitle>
          <DialogDescription className="text-kraft-600">演示版没有接入识别模型：下面的候选来自 {mockRecognizer.name}，请点选或直接修改，再写到纸上。</DialogDescription>
        </DialogHeader>
        {box && (
          <div className="kraft-page rounded-xl border border-kraft-600/25 p-2">
            <svg viewBox={box} className="mx-auto h-28 w-full">
              <StrokeDefs />
              {strokes!.map((s) => (
                <StrokeShape key={s.id} s={s} />
              ))}
            </svg>
          </div>
        )}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-kraft-700">
            <Wand2 className="size-3.5" /> 识别候选
          </div>
          {!cands ? (
            <div className="flex items-center gap-2 text-[13px] text-kraft-600">
              <Loader2 className="size-4 animate-spin" /> 正在“识别”…
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {cands.map((c) => (
                <button key={c.text} onClick={() => setText(c.text)} className={cn('touch-target flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px]', text === c.text ? 'border-kraft-700 bg-kraft-700 text-kraft-50 [&_.katex]:text-kraft-50' : 'border-kraft-600/25 bg-kraft-50/70 hover:bg-kraft-50')}>
                  <Tex tex={summarizeCard(c.text).lines[0]?.latex ?? c.text} />
                  <span className="text-[10px] opacity-70">{Math.round(c.confidence * 100)}%</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            const sn = matchSnippet(e)
            if (sn) {
              e.preventDefault()
              insertSnippet(e.currentTarget, text, setText, sn)
            } else if (e.key === 'Tab') {
              const i = nextPlaceholder(text, e.currentTarget.selectionEnd)
              if (i >= 0) {
                e.preventDefault()
                e.currentTarget.setSelectionRange(i, i + 1)
              }
            } else if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
              e.preventDefault()
              onConfirm(text, keep)
            }
          }}
          rows={2}
          spellCheck={false}
          className="w-full resize-none rounded-xl border border-kraft-600/25 bg-kraft-50/70 px-3 py-2 font-mono text-[15px] text-ink outline-none focus:border-kraft-600"
          placeholder="修改识别结果，例如 y = x^2 - 2"
        />
        {summary && (
          <div className="rounded-xl bg-kraft-50/50 px-3 py-2 text-[17px]">
            {summary.lines.map((l, i) => (
              <div key={i} className={cn(l.error && 'text-ink-red')}>
                <Tex tex={l.latex} />
                {l.error && <div className="text-[11px]">{l.error}</div>}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px] text-kraft-700">
            <Switch checked={keep} onCheckedChange={setKeep} /> 保留原手写笔迹
          </label>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-10 rounded-xl px-4 text-[13px] text-kraft-700 hover:bg-kraft-200">
              取消
            </button>
            <button onClick={() => onConfirm(text, keep)} disabled={!text.trim()} className="h-10 rounded-xl bg-kraft-700 px-4 text-[13px] font-medium text-kraft-50 hover:bg-kraft-800 disabled:opacity-40">
              写成公式
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
