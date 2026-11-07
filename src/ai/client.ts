import { getLang, t } from '../i18n/locale.ts'
import { joinUrl, missingConfig, resolveBaseUrl, type AiConfig } from './config.ts'
import { TOOL_SPECS, type ToolSpec } from './specs.ts'

export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

export interface AiTransport {
  request(url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }): Promise<{ status: number; text: string }>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface AssistStep {
  name: string
  args: Record<string, unknown>
  result: unknown
}

export interface FormulaRef {
  id: string
  text: string
}

const TEST_TIMEOUT_MS = 12_000
const CHAT_TIMEOUT_MS = 30_000
const MAX_ROUNDS = 4

const SYSTEM_ZH = `你是 MathScrap 的纸面推导助手。用户在一张牛皮纸上写公式，整页共用一套坐标系。数值和几何推导交给工具 solve_analyze（Rust），不要心算代替它。

写法：
- 使用 ASCII 数学，例如 y = x^2 - 2、△ABC: a=3, b=4, C=90°。
- 向量必须用粗体加等号：**b** = (1, 2) 或 **a** = (1, 2, 2)。不要写成 b = (1, 2)。
- 点用大写字母：A(0, 0)。

做法：
- 需要在纸上写下一步时调用 page_add_formula（一次一个最有用的式子）或 page_update_formula。
- 需要交点、解三角形、未知数时调用 solve_analyze，texts 为式子数组。
- 需要改坐标范围、3D 相机或叠加哪些式子时调用 plot_set_view；需要看手写点列时调用 ink_read。
- 然后用一两句中文说明这一步。没有把握就不要编造式子。

如果接口不支持工具调用，只输出一个 JSON 对象，不要加别的文字：
{"add":["要写到纸上的式子"],"analyze":true,"note":"一句说明"}
add 可以省略。`

const SYSTEM_EN = `You are MathScrap's on-paper derivation assistant. The user writes formulas on one kraft sheet that shares one coordinate system. Hand numeric and geometric derivation to the tool solve_analyze (Rust). Do not do that arithmetic yourself.

Notation:
- Use ASCII math, for example y = x^2 - 2 or △ABC: a=3, b=4, C=90°.
- A vector must be bold with an equals sign: **b** = (1, 2) or **a** = (1, 2, 2). Do not write b = (1, 2).
- Name a point with a capital letter: A(0, 0).

What to do:
- To write the next step on the sheet, call page_add_formula (one useful formula) or page_update_formula.
- For intersections, solving a triangle, or an unknown, call solve_analyze with texts as the formula array.
- To change ranges, the 3D camera, or which formulas are shown, call plot_set_view. To read ink points, call ink_read.
- Then explain the step in one or two English sentences. Do not invent a formula you are not sure about.

If the endpoint does not support tool calls, output only one JSON object and no other text:
{"add":["formula to write on the sheet"],"analyze":true,"note":"one sentence"}
add may be omitted.`

function systemPrompt() {
  return getLang() === 'zh' ? SYSTEM_ZH : SYSTEM_EN
}

interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
}

export function directTransport(fetchImpl: typeof fetch = fetch): AiTransport {
  return {
    async request(url, init) {
      const res = await fetchImpl(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal })
      return { status: res.status, text: await res.text() }
    },
  }
}

/** Strip secrets that a provider might echo back into an error body. */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-…')
    .replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer …')
    .replace(/(x-api-key|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2…')
}

export async function testConnection(cfg: AiConfig, transport: AiTransport = directTransport(), signal?: AbortSignal): Promise<string> {
  const gap = missingConfig(cfg)
  if (gap) throw new AiError(gap)
  const base = resolveBaseUrl(cfg)
  if (cfg.provider === 'anthropic') {
    const { status, text } = await send(transport, joinUrl(base, 'v1/messages'), {
      method: 'POST',
      headers: anthropicHeaders(cfg),
      body: JSON.stringify({ model: cfg.model.trim(), max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal,
      timeout: TEST_TIMEOUT_MS,
    })
    if (status < 200 || status >= 300) throw httpError(status, text)
    return t('connectedAnthropic', { model: cfg.model.trim() })
  }
  const headers = openaiHeaders(cfg)
  const models = await send(transport, joinUrl(base, 'models'), { method: 'GET', headers, signal, timeout: TEST_TIMEOUT_MS })
  if (models.status >= 200 && models.status < 300) {
    const ids = modelIds(models.text)
    const name = cfg.model.trim()
    if (ids.length && !ids.includes(name)) throw new AiError(t('modelMissing', { name }))
    return connectedLabel(cfg)
  }
  const authFailed = models.status === 401 || models.status === 403
  const canFallback = !authFailed && (models.status === 400 || models.status === 404 || models.status === 405 || models.status === 501)
  if (!canFallback) throw httpError(models.status, models.text)
  const chat = await send(transport, joinUrl(base, 'chat/completions'), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model.trim(), messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
    signal,
    timeout: TEST_TIMEOUT_MS,
  })
  if (chat.status < 200 || chat.status >= 300) throw httpError(chat.status, chat.text)
  return connectedLabel(cfg)
}

export async function assist(opts: {
  config: AiConfig
  prompt: string
  formulas: FormulaRef[]
  strokes?: number
  callTool: (name: string, args: Record<string, unknown>) => unknown
  transport?: AiTransport
  signal?: AbortSignal
}): Promise<{ text: string; steps: AssistStep[] }> {
  const gap = missingConfig(opts.config)
  if (gap) throw new AiError(gap)
  const transport = opts.transport ?? directTransport()
  const steps: AssistStep[] = []
  const messages: Msg[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: userPrompt(opts.formulas, opts.strokes ?? 0, opts.prompt.trim() || t('assist')) },
  ]
  let text = ''
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await complete(opts.config, messages, TOOL_SPECS, transport, opts.signal)
    text = res.text
    if (!res.toolCalls.length) {
      const suggestion = round === 0 ? extractSuggestions(res.text) : null
      if (suggestion && (suggestion.add.length || suggestion.analyze)) {
        const added = applySuggestion(suggestion, opts.formulas, opts.callTool, steps)
        text = suggestion.note || (added ? t('wroteOnSheet') : text)
      }
      break
    }
    messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls })
    for (const call of res.toolCalls) {
      let result: unknown
      try {
        result = opts.callTool(call.name, call.arguments)
      } catch (e) {
        result = { error: e instanceof Error ? e.message : t('toolFailed') }
      }
      steps.push({ name: call.name, args: call.arguments, result })
      messages.push({ role: 'tool', content: clip(result), toolCallId: call.id, name: call.name })
    }
  }
  if (!text && steps.length) text = t('handledByTools')
  return { text, steps }
}

export function extractSuggestions(text: string): { add: string[]; analyze: boolean; note: string } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced?.[1] ?? text).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    if (!('add' in obj) && !('formulas' in obj) && !('texts' in obj) && !('analyze' in obj) && !('solve' in obj) && !('note' in obj)) return null
    const addRaw = obj.add ?? obj.formulas ?? obj.texts
    const add = Array.isArray(addRaw) ? addRaw.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : []
    const note = typeof obj.note === 'string' ? obj.note.trim() : ''
    const analyze = obj.analyze === true || obj.solve === true
    if (!add.length && !analyze && !note) return null
    return { add, analyze, note }
  } catch {
    return null
  }
}

function applySuggestion(suggestion: { add: string[]; analyze: boolean }, formulas: FormulaRef[], callTool: (name: string, args: Record<string, unknown>) => unknown, steps: AssistStep[]) {
  for (const text of suggestion.add) {
    const args = { text }
    let result: unknown
    try {
      result = callTool('page_add_formula', args)
    } catch (e) {
      result = { error: e instanceof Error ? e.message : t('toolFailed') }
    }
    steps.push({ name: 'page_add_formula', args, result })
  }
  if (suggestion.analyze) {
    const args = { texts: [...formulas.map((f) => f.text), ...suggestion.add] }
    let result: unknown
    try {
      result = callTool('solve_analyze', args)
    } catch (e) {
      result = { error: e instanceof Error ? e.message : t('toolFailed') }
    }
    steps.push({ name: 'solve_analyze', args, result })
  }
  return suggestion.add.length > 0
}

async function complete(cfg: AiConfig, messages: Msg[], tools: ToolSpec[], transport: AiTransport, signal?: AbortSignal): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const base = resolveBaseUrl(cfg)
  if (cfg.provider === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const { status, text } = await send(transport, joinUrl(base, 'v1/messages'), {
      method: 'POST',
      headers: anthropicHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model.trim(),
        max_tokens: 1024,
        system,
        messages: toAnthropic(messages),
        tools: tools.filter((t) => t.status === 'local').map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      }),
      signal,
      timeout: CHAT_TIMEOUT_MS,
    })
    if (status < 200 || status >= 300) throw httpError(status, text)
    return parseAnthropic(text)
  }
  const { status, text } = await send(transport, joinUrl(base, 'chat/completions'), {
    method: 'POST',
    headers: { ...openaiHeaders(cfg), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model.trim(),
      messages: toOpenAi(messages),
      tools: tools.filter((t) => t.status === 'local').map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      tool_choice: 'auto',
      temperature: 0.2,
      stream: false,
    }),
    signal,
    timeout: CHAT_TIMEOUT_MS,
  })
  if (status < 200 || status >= 300) throw httpError(status, text)
  return parseOpenAi(text)
}

function toOpenAi(messages: Msg[]) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
      }
    }
    return { role: m.role, content: m.content }
  })
}

function toAnthropic(messages: Msg[]) {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const blocks: Record<string, unknown>[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const call of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })
      if (blocks.length) out.push({ role: 'assistant', content: blocks })
      continue
    }
    const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
    const prev = out[out.length - 1]
    if (prev?.role === 'user' && Array.isArray(prev.content)) prev.content.push(block)
    else out.push({ role: 'user', content: [block] })
  }
  return out
}

function parseOpenAi(text: string): { text: string; toolCalls: ToolCall[] } {
  const data = parseJson(text)
  const err = errorMessage(data)
  if (err) throw new AiError(redact(err))
  const message = (data.choices as { message?: { content?: unknown; tool_calls?: unknown[] } }[] | undefined)?.[0]?.message
  const content = typeof message?.content === 'string' ? message.content : ''
  const toolCalls = (message?.tool_calls ?? []).map((call, i) => {
    const c = call as { id?: string; function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown }
    const name = c.function?.name || c.name || ''
    return { id: c.id || `call_${i}`, name, arguments: parseArgs(c.function?.arguments ?? c.arguments) }
  }).filter((call) => call.name)
  return { text: content, toolCalls }
}

function parseAnthropic(text: string): { text: string; toolCalls: ToolCall[] } {
  const data = parseJson(text)
  const err = errorMessage(data)
  if (err) throw new AiError(redact(err))
  const blocks = (data.content as { type?: string; text?: string; id?: string; name?: string; input?: unknown }[] | undefined) ?? []
  const parts: string[] = []
  const toolCalls: ToolCall[] = []
  blocks.forEach((block, i) => {
    if (block.type === 'text' && block.text) parts.push(block.text)
    if (block.type === 'tool_use' && block.name) toolCalls.push({ id: block.id || `tool_${i}`, name: block.name, arguments: parseArgs(block.input) })
  })
  return { text: parts.join('\n').trim(), toolCalls }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const data = JSON.parse(text) as unknown
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    throw new AiError(t('notJson'))
  }
}

function errorMessage(data: Record<string, unknown>): string | null {
  const err = data.error
  if (!err) return null
  if (typeof err === 'string') return err
  if (typeof err === 'object' && err && 'message' in err && typeof (err as { message: unknown }).message === 'string') return (err as { message: string }).message
  return t('apiError')
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const value = JSON.parse(raw) as unknown
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

function modelIds(text: string): string[] {
  try {
    const data = JSON.parse(text) as { data?: { id?: string; name?: string }[]; models?: { name?: string; id?: string }[] }
    const rows: { id?: string; name?: string }[] = data.data ?? data.models ?? []
    return rows.map((row) => (row.id ?? row.name ?? '').replace(/^models\//, '')).filter(Boolean)
  } catch {
    return []
  }
}

function userPrompt(formulas: FormulaRef[], strokes: number, prompt: string) {
  const lines = formulas.slice(0, 40).map((f) => `- [${f.id}] ${f.text.replace(/\s+/g, ' ').slice(0, 500)}`)
  const page = lines.length ? lines.join('\n') : t('emptySheet')
  return t('promptSheet', { page, strokes, prompt })
}

function clip(value: unknown) {
  const text = JSON.stringify(value) ?? 'null'
  return text.length > 8000 ? `${text.slice(0, 8000)}…` : text
}

function connectedLabel(cfg: AiConfig) {
  const name = cfg.model.trim()
  return cfg.provider === 'local' ? t('connectedLocal', { name }) : t('connectedOpenAI', { name })
}

function openaiHeaders(cfg: AiConfig): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const key = cfg.apiKey.trim()
  if (key) headers.authorization = `Bearer ${key}`
  return headers
}

function anthropicHeaders(cfg: AiConfig): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey.trim(),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

function httpError(status: number, text: string) {
  if (status === 401 || status === 403) return new AiError(t('keyRejected', { status }))
  const snippet = redact(text).replace(/\s+/g, ' ').slice(0, 280)
  return new AiError(t('httpError', { status, snippet: snippet ? `: ${snippet}` : '' }))
}

async function send(transport: AiTransport, url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; timeout: number }) {
  const gate = abortAfter(init.timeout, init.signal)
  try {
    return await transport.request(url, { method: init.method, headers: init.headers, body: init.body, signal: gate.signal })
  } catch (e) {
    if (isAbort(e)) throw new AiError(init.signal?.aborted ? t('cancelled') : t('timeout'))
    const message = e instanceof Error ? e.message : t('network')
    throw new AiError(t('cannotReach', { message: redact(message) }))
  } finally {
    gate.cancel()
  }
}

function isAbort(e: unknown) {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}

function abortAfter(ms: number, parent?: AbortSignal) {
  const ctrl = new AbortController()
  let timed = false
  const timer = setTimeout(() => {
    timed = true
    ctrl.abort()
  }, ms)
  const onParent = () => {
    clearTimeout(timer)
    ctrl.abort()
  }
  if (parent?.aborted) onParent()
  else parent?.addEventListener('abort', onParent, { once: true })
  return {
    signal: ctrl.signal,
    timedOut: () => timed,
    cancel: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParent)
    },
  }
}
