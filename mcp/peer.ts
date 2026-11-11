import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { presentedSession, sessionCookieHeader, sessionMatches, shareMatches, shareTokenUsable } from './session.ts'

/**
 * Loopback bridge authorization.
 * Origin and Sec-Fetch-Site are not the capability: a missing or forged
 * pair is refused unless the HttpOnly session cookie matches.
 * The cookie is issued on a browser document navigation, or on an explicit
 * LAN join that presents the operator's share token.
 * A same-machine process that forges a document navigation can still obtain
 * the cookie. A same-user process can read the session file. That remains.
 */
export function peerAllowed(req: IncomingMessage, browserRoute: boolean): boolean {
  if (isWebsocket(req)) return false
  if (!hostMatchesConnection(req)) return false
  if (!sessionMatches(presentedSession(req))) return false
  const origin = header(req, 'origin')
  if (origin === 'null') return false
  if (origin && !localOrigin(origin) && !lanOrigin(req, origin)) return false
  if (origin && !sameHost(origin, header(req, 'host'))) return false
  if (browserRoute && !origin) return sameOriginGet(req)
  return true
}

export function stampNavigation(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (!isLoopback(req.socket?.remoteAddress)) return false
  if (!hostIsLoopback(header(req, 'host'))) return false
  if (header(req, 'sec-fetch-dest') !== 'document' || header(req, 'sec-fetch-mode') !== 'navigate') return false
  appendCookie(res)
  return true
}

/** Share token is exchanged for the session cookie. It does not authorize /call by itself. */
export function lanJoinAllowed(req: IncomingMessage, share: string): boolean {
  if (!shareTokenUsable() || !shareMatches(share)) return false
  if (isLoopback(req.socket?.remoteAddress)) return false
  return lanHostOk(header(req, 'host'), req.socket?.localAddress)
}

export function lanHostOk(hostHeader: string, localAddress: string | undefined): boolean {
  const host = hostName(hostHeader)
  const local = normalizeIp(localAddress)
  return isIP(host) !== 0 && host === local && !isLoopback(local)
}

export function isLoopback(address: string | undefined): boolean {
  const host = normalizeIp(address)
  return host === '::1' || host.startsWith('127.')
}

export function localOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    const host = url.hostname.toLowerCase()
    return (url.protocol === 'http:' || url.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1' || host === '::1')
  } catch {
    return false
  }
}

export function hostIsLoopback(hostHeader: string): boolean {
  const host = hostName(hostHeader)
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function hostMatchesConnection(req: IncomingMessage): boolean {
  if (isLoopback(req.socket?.remoteAddress)) return hostIsLoopback(header(req, 'host'))
  if (!shareTokenUsable()) return false
  return lanHostOk(header(req, 'host'), req.socket?.localAddress)
}

function lanOrigin(req: IncomingMessage, origin: string): boolean {
  if (!shareTokenUsable() || isLoopback(req.socket?.remoteAddress)) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && lanHostOk(url.hostname, req.socket?.localAddress)
  } catch {
    return false
  }
}

function sameHost(origin: string, hostHeader: string): boolean {
  try {
    return new URL(origin).hostname.toLowerCase() === hostName(hostHeader)
  } catch {
    return false
  }
}

function sameOriginGet(req: IncomingMessage): boolean {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return false
  return header(req, 'sec-fetch-site').toLowerCase() === 'same-origin'
}

function isWebsocket(req: IncomingMessage): boolean {
  const upgrade = header(req, 'upgrade').toLowerCase()
  return upgrade === 'websocket' || upgrade.split(',').some((part) => part.trim() === 'websocket')
}

export function grantSession(res: ServerResponse) {
  appendCookie(res)
}

function appendCookie(res: ServerResponse) {
  const value = sessionCookieHeader()
  const prev = res.getHeader('set-cookie')
  if (!prev) res.setHeader('set-cookie', value)
  else if (Array.isArray(prev)) res.setHeader('set-cookie', [...prev.map(String), value])
  else res.setHeader('set-cookie', [String(prev), value])
}

export function normalizeIp(address: string | undefined): string {
  if (!address) return ''
  const host = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  return mapped ? mapped[1] : host
}

function hostName(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 1 ? value.slice(1, end) : ''
  }
  return value.split(':')[0] ?? ''
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}
