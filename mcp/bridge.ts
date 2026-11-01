import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readBody, sendEmpty, sendJson } from './http.ts'

export const BRIDGE_HEADER = 'x-mathscrap-bridge'
const MARK = { [BRIDGE_HEADER]: '1' }
const CALL_MS = 15_000
const FRESH_MS = 4_000

export interface BridgeCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface Pending {
  resolve: (value: { ok: boolean; result?: unknown; error?: string }) => void
  timer: NodeJS.Timeout
}

/**
 * In-memory queue between the MCP process (POST /call) and the open MathScrap page
 * (GET /wait, POST /result). The page polls; nothing is held open, so the dev
 * server can still go network-idle.
 */
export function createBridge() {
  const queue: BridgeCall[] = []
  const pending = new Map<string, Pending>()
  let lastSeen = 0

  const browserLive = () => Date.now() - lastSeen < FRESH_MS

  function deliverResult(id: string, body: { ok: boolean; result?: unknown; error?: string }) {
    const job = pending.get(id)
    if (!job) return false
    clearTimeout(job.timer)
    pending.delete(id)
    job.resolve(body)
    return true
  }

  async function call(name: string, args: Record<string, unknown>) {
    if (!browserLive()) {
      return { ok: false as const, error: 'MathScrap 页面还没连上。先运行 npm run dev，并在本机浏览器打开 http://127.0.0.1:47321 。' }
    }
    const id = randomUUID()
    const result = new Promise<{ ok: boolean; result?: unknown; error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, error: `工具 ${name} 等待页面响应超时` })
      }, CALL_MS)
      pending.set(id, { resolve, timer })
    })
    queue.push({ id, name, arguments: args })
    return result
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = (req.url ?? '').split('?')[0] ?? ''
    if (!path.startsWith('/__mathscrap/bridge')) return false
    try {
      if (req.method === 'GET' && path === '/__mathscrap/bridge/health') {
        sendJson(res, 200, { ok: true, browser: browserLive() }, MARK)
        return true
      }
      if (req.method === 'GET' && path === '/__mathscrap/bridge/wait') {
        lastSeen = Date.now()
        const job = queue.shift()
        if (!job) sendEmpty(res, 204, MARK)
        else sendJson(res, 200, job, MARK)
        return true
      }
      if (req.method === 'POST' && path === '/__mathscrap/bridge/result') {
        const body = parseObject(await readBody(req, 8_000_000))
        const id = typeof body.id === 'string' ? body.id : ''
        const error = typeof body.error === 'string' ? body.error : undefined
        const ok = body.ok !== false && !error
        const done = deliverResult(id, { ok, result: body.result, error })
        sendJson(res, done ? 200 : 404, { ok: done }, MARK)
        return true
      }
      if (req.method === 'POST' && path === '/__mathscrap/bridge/call') {
        const body = parseObject(await readBody(req, 1_000_000))
        const name = typeof body.name === 'string' ? body.name : ''
        if (!name) {
          sendJson(res, 400, { ok: false, error: '缺少工具名' }, MARK)
          return true
        }
        const args = body.arguments && typeof body.arguments === 'object' ? (body.arguments as Record<string, unknown>) : {}
        const out = await call(name, args)
        sendJson(res, out.ok ? 200 : 502, out, MARK)
        return true
      }
      sendJson(res, 404, { ok: false, error: '未知桥接路径' }, MARK)
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : '桥接失败'
      if (!res.headersSent && !res.writableEnded) sendJson(res, 400, { ok: false, error: message }, MARK)
      return true
    }
  }

  return { handle, call, browserLive }
}

function parseObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const data = JSON.parse(raw) as unknown
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}
