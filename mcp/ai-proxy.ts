import type { IncomingMessage, ServerResponse } from 'node:http'
import { readBody, sendJson } from './http.ts'

export const PROXY_HEADER = 'x-mathscrap-proxy'

const ALLOWED_HEADERS = new Set(['authorization', 'content-type', 'accept', 'x-api-key', 'anthropic-version', 'anthropic-dangerous-direct-browser-access'])

/**
 * Forwards one provider request from the page. Dev-only.
 * Never log the body or headers — they may contain the API key.
 * Only chat/models/messages paths are allowed, and link-local metadata hosts are refused.
 */
export async function forwardAi(payload: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown }, fetchImpl: typeof fetch = fetch, signal?: AbortSignal) {
  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'GET'
  if (method !== 'GET' && method !== 'POST') throw new Error('只允许 GET 或 POST')
  if (typeof payload.url !== 'string' || !payload.url) throw new Error('缺少目标地址')
  let target: URL
  try {
    target = new URL(payload.url)
  } catch {
    throw new Error('目标地址不合法')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('只允许 http 或 https')
  if (target.username || target.password) throw new Error('地址里不能带账号')
  if (isBlockedHost(target.hostname)) throw new Error('拒绝访问该地址')
  if (!allowedPath(target.pathname)) throw new Error('只转发模型列表、对话补全或 Messages 接口')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (payload.headers && typeof payload.headers === 'object') {
    for (const [key, value] of Object.entries(payload.headers as Record<string, unknown>)) {
      if (typeof value !== 'string' || value.length > 8000) continue
      if (!ALLOWED_HEADERS.has(key.toLowerCase())) continue
      headers[key] = value
    }
  }
  const timeout = AbortSignal.timeout(25_000)
  const upstream = await fetchImpl(target, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(payload.body ?? {}) : undefined,
    redirect: 'error',
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  })
  const text = (await upstream.text()).slice(0, 200_000)
  return { status: upstream.status, text, contentType: upstream.headers.get('content-type') ?? 'application/json; charset=utf-8' }
}

export async function handleAiProxy(req: IncomingMessage, res: ServerResponse, fetchImpl?: typeof fetch) {
  const path = (req.url ?? '').split('?')[0] ?? ''
  if (req.method !== 'POST' || path !== '/__mathscrap/ai/forward') {
    sendJson(res, 404, { error: '未知路径' }, { [PROXY_HEADER]: '1' })
    return
  }
  try {
    const payload = JSON.parse(await readBody(req, 1_000_000)) as { url?: unknown; method?: unknown; headers?: unknown; body?: unknown }
    const ac = new AbortController()
    req.on('aborted', () => ac.abort())
    const upstream = await forwardAi(payload, fetchImpl, ac.signal)
    res.statusCode = upstream.status
    res.setHeader('content-type', upstream.contentType)
    res.setHeader('cache-control', 'no-store')
    res.setHeader(PROXY_HEADER, '1')
    res.end(upstream.text)
  } catch (e) {
    if (res.writableEnded) return
    const message = e instanceof Error ? e.message : '转发失败'
    sendJson(res, 400, { error: message }, { [PROXY_HEADER]: '1' })
  }
}

export function allowedPath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path.endsWith('/models') || path.endsWith('/chat/completions') || path.endsWith('/messages')
}

export function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'metadata.google.internal' || host === 'metadata.google.com') return true
  if (host.endsWith('.internal') && host.includes('metadata')) return true
  const v4 = host.startsWith('::ffff:') ? host.slice(7) : host
  return /^169\.254\./.test(v4)
}
