import { t } from '../src/i18n/locale.ts'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readBody, sendJson } from './http.ts'
import { allowPrivateAi, isBlockedHostname, resolveAndCheck, type LookupFn } from './ssrf.ts'
import { peerAllowed } from './peer.ts'

export const PROXY_HEADER = 'x-mathscrap-proxy'

const ALLOWED_HEADERS = new Set(['authorization', 'content-type', 'accept', 'x-api-key', 'anthropic-version', 'anthropic-dangerous-direct-browser-access'])

export type ForwardDeps = {
  lookup?: LookupFn
  allowPrivate?: boolean
}

/**
 * Forwards one provider request from the page. Dev-only.
 * Never log the body or headers — they may contain the API key.
 * Only chat/models/messages paths are allowed, and link-local metadata hosts are refused.
 */
export async function forwardAi(
  payload: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  deps: ForwardDeps = {},
) {
  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'GET'
  if (method !== 'GET' && method !== 'POST') throw new Error(t('proxyMethod'))
  if (typeof payload.url !== 'string' || !payload.url) throw new Error(t('proxyTarget'))
  let target: URL
  try {
    target = new URL(payload.url)
  } catch {
    throw new Error(t('proxyBadTarget'))
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error(t('proxyHttp'))
  if (target.username || target.password) throw new Error(t('proxyUserinfo'))
  if (!allowedPath(target.pathname)) throw new Error(t('proxyPath'))
  const allowPrivate = deps.allowPrivate ?? allowPrivateAi()
  if (isBlockedHostname(target.hostname, allowPrivate)) throw new Error(t('proxyBlocked'))
  let addresses
  try {
    addresses = await resolveAndCheck(target.hostname, deps.lookup, allowPrivate)
  } catch {
    throw new Error(t('proxyBlocked'))
  }
  const headers: Record<string, string> = { accept: 'application/json' }
  if (payload.headers && typeof payload.headers === 'object') {
    for (const [key, value] of Object.entries(payload.headers as Record<string, unknown>)) {
      if (typeof value !== 'string' || value.length > 8000) continue
      if (!ALLOWED_HEADERS.has(key.toLowerCase())) continue
      headers[key] = value
    }
  }
  if (fetchImpl) {
    const timeout = AbortSignal.timeout(25_000)
    const upstream = await fetchImpl(target, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(payload.body ?? {}) : undefined,
      redirect: 'error',
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    })
    if (upstream.status >= 300 && upstream.status < 400) throw new Error(t('proxyBlocked'))
    const text = (await upstream.text()).slice(0, 200_000)
    return { status: upstream.status, text, contentType: upstream.headers.get('content-type') ?? 'application/json; charset=utf-8' }
  }
  return requestPinned(target, method, headers, method === 'POST' ? JSON.stringify(payload.body ?? {}) : undefined, addresses, signal, deps)
}

export async function handleAiProxy(req: IncomingMessage, res: ServerResponse, fetchImpl?: typeof fetch) {
  const path = (req.url ?? '').split('?')[0] ?? ''
  if (req.method !== 'POST' || path !== '/__mathscrap/ai/forward') {
    sendJson(res, 404, { error: '未知路径' }, { [PROXY_HEADER]: '1' })
    return
  }
  if (!peerAllowed(req, true)) {
    sendJson(res, 403, { error: t('proxyBlocked') }, { [PROXY_HEADER]: '1' })
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
  return isBlockedHostname(hostname, false)
}

function requestPinned(
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  addresses: { address: string; family: number }[],
  signal?: AbortSignal,
  deps: ForwardDeps = {},
) {
  const lib = target.protocol === 'https:' ? https : http
  const pinned = addresses[0]
  return new Promise<{ status: number; text: string; contentType: string }>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: pinned.address,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers: { ...headers, host: target.host },
        servername: target.hostname,
        lookup: (_hostname, _options, callback) => {
          resolveAndCheck(target.hostname, deps.lookup, deps.allowPrivate ?? allowPrivateAi())
            .then((again) => {
              if (again.some((item) => item.address !== pinned.address)) {
                callback(new Error('blocked'), '', 4)
                return
              }
              callback(null, pinned.address, pinned.family)
            })
            .catch((error: Error) => callback(error, '', 4))
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          res.resume()
          reject(new Error(t('proxyBlocked')))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 502,
            text: Buffer.concat(chunks).subarray(0, 200_000).toString('utf8'),
            contentType: String(res.headers['content-type'] ?? 'application/json; charset=utf-8'),
          })
        })
      },
    )
    const fail = (error: Error) => reject(error.message === 'blocked' ? new Error(t('proxyBlocked')) : error)
    req.on('error', fail)
    signal?.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
    if (body) req.write(body)
    req.end()
  })
}
