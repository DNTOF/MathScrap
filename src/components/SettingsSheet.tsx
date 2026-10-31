import { Bot, Copy, Cpu, PenTool, Plug } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { TOOL_SPECS } from '@/ai/tools'
import { engine } from '@/wasm/engine'

export interface Prefs {
  penOnly: boolean
  showGrid: boolean
  showHints: boolean
  /** handwriting → formula candidates raised automatically on settled ink (default on) */
  autoOcr: boolean
}

const AI_KEY = 'mathscrap.ai.v1'

interface AiConfig {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}

function loadAi(): AiConfig {
  try {
    return { provider: 'openai-compatible', baseUrl: '', model: '', apiKey: '', ...JSON.parse(localStorage.getItem(AI_KEY) ?? '{}') }
  } catch {
    return { provider: 'openai-compatible', baseUrl: '', model: '', apiKey: '' }
  }
}

export function SettingsSheet({ open, onOpenChange, prefs, setPrefs, side }: { open: boolean; onOpenChange: (o: boolean) => void; prefs: Prefs; setPrefs: (p: Prefs) => void; side: 'right' | 'bottom' }) {
  const [ai, setAi] = useState<AiConfig>(loadAi)
  const save = () => {
    localStorage.setItem(AI_KEY, JSON.stringify(ai))
    toast.success('已保存在本机浏览器（演示版不会发送任何请求）')
  }
  const row = (label: string, desc: string, checked: boolean, on: (v: boolean) => void) => (
    <label className="flex items-start justify-between gap-3 rounded-xl bg-kraft-50/50 px-3 py-2.5">
      <span>
        <span className="block text-[13.5px] font-medium text-kraft-800">{label}</span>
        <span className="block text-[11.5px] text-kraft-600">{desc}</span>
      </span>
      <Switch checked={checked} onCheckedChange={on} />
    </label>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={`kraft-panel overflow-y-auto bg-transparent ${side === 'bottom' ? 'max-h-[88dvh] rounded-t-2xl' : 'w-[400px] sm:max-w-[400px]'}`} data-no-board>
        <SheetHeader>
          <SheetTitle className="hand text-[28px] text-kraft-800">设置</SheetTitle>
          <SheetDescription className="text-kraft-600">书写习惯、AI 接口预留与引擎信息。</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-8">
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-widest text-kraft-600">
              <PenTool className="size-3.5" /> 书写
            </h3>
            {row('仅触控笔书写', '平板上手指只负责平移 / 缩放（检测到手写笔后自动开启）', prefs.penOnly, (v) => setPrefs({ ...prefs, penOnly: v }))}
            {row('手写自动识别', '写完稍停，纸上自动浮出识别候选，点一下就写成公式（默认开；也可随时按 R 手动识别）', prefs.autoOcr, (v) => setPrefs({ ...prefs, autoOcr: v }))}
            {row('输入时在纸面显示快捷键', '写公式时把快捷键表淡淡地“印”在牛皮纸上', prefs.showHints, (v) => setPrefs({ ...prefs, showHints: v }))}
            {row('点阵纸', '跟随缩放的浅色点阵', prefs.showGrid, (v) => setPrefs({ ...prefs, showGrid: v }))}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-widest text-kraft-600">
              <Bot className="size-3.5" /> AI 接口（预留）
            </h3>
            <p className="rounded-xl bg-kraft-200/60 px-3 py-2 text-[12px] leading-relaxed text-kraft-800">后续可接入大模型：读懂整页手写、补全条件、讲解推导步骤。演示版只保存配置，不发起网络请求。</p>
            <div className="grid gap-2">
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">服务类型</Label>
                <select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value })} className="h-10 rounded-lg border border-kraft-600/25 bg-kraft-50/70 px-2 text-[13px] outline-none">
                  <option value="openai-compatible">OpenAI 兼容接口</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="local">本地模型（Ollama 等）</option>
                </select>
              </div>
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">Base URL</Label>
                <Input value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" className="h-10 bg-kraft-50/70" />
              </div>
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">模型</Label>
                <Input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} placeholder="model-name" className="h-10 bg-kraft-50/70" />
              </div>
              <div className="grid gap-1">
                <Label className="text-[12px] text-kraft-700">API Key</Label>
                <Input type="password" value={ai.apiKey} onChange={(e) => setAi({ ...ai, apiKey: e.target.value })} placeholder="仅保存在本机" className="h-10 bg-kraft-50/70" />
              </div>
              <div className="flex gap-2">
                <button onClick={save} className="h-10 flex-1 rounded-xl bg-kraft-700 text-[13px] font-medium text-kraft-50 hover:bg-kraft-800">
                  保存到本机
                </button>
                <button onClick={() => toast('演示版未接入 AI：这里将来会发一条测试请求')} className="h-10 flex-1 rounded-xl border border-kraft-600/30 text-[13px] text-kraft-800 hover:bg-kraft-200">
                  测试连接
                </button>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-widest text-kraft-600">
              <Plug className="size-3.5" /> MCP 工具（规划）
            </h3>
            <p className="text-[12px] leading-relaxed text-kraft-700">
              这些工具让外部 AI 读取页面、增改公式、操控坐标系。标记“本地可用”的已经能在浏览器控制台通过 <code className="rounded bg-kraft-200 px-1">window.mathscrap.tools.call(name, args)</code> 调用。
            </p>
            <ul className="flex flex-col gap-1.5">
              {TOOL_SPECS.map((t) => (
                <li key={t.name} className="rounded-xl bg-kraft-50/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-[12.5px] font-semibold text-kraft-800">{t.name}</code>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${t.status === 'local' ? 'bg-ink-green/85 text-kraft-50' : 'bg-kraft-300 text-kraft-800'}`}>{t.status === 'local' ? '本地可用' : '规划中'}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-kraft-600">{t.description}</div>
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(JSON.stringify(TOOL_SPECS, null, 2))
                toast.success('工具清单 JSON 已复制')
              }}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-kraft-600/30 text-[13px] text-kraft-800 hover:bg-kraft-200"
            >
              <Copy className="size-4" /> 复制工具清单 JSON
            </button>
          </section>

          <section className="flex flex-col gap-1 rounded-xl bg-kraft-50/50 px-3 py-2.5 text-[12px] text-kraft-700">
            <h3 className="flex items-center gap-1.5 font-semibold text-kraft-800">
              <Cpu className="size-3.5" /> 计算引擎
            </h3>
            <span>{engine.version()} · Rust 编译为 WebAssembly</span>
            <span>负责：表达式解析与 LaTeX、采样、求根 / 交点、方程组（LM 多起点）、解三角形、坐标几何、向量、平面、圆锥曲线。</span>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
