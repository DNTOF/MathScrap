import type { IncomingMessage } from 'node:http'

/**
 * The dev bridge is a loopback service. A browser Origin of localhost does not
 * prove which local process is calling. Node's MCP client omits Origin on
 * POST /call. Chrome's same-origin GET also omits Origin and sends
 * Sec-Fetch-Site: same-origin, which a page script cannot set.
 * Non-loopback peers are always refused. LAN bind does not extend this.
 */
export function peerAllowed(req: IncomingMessage, browserRoute: boolean): boolean {
  if (isWebsocket(req)) return false
  if (!hostIsLoopback(header(req, 'host'))) return false
  if (!isLoopback(req.socket?.remoteAddress)) return false
  const origin = header(req, 'origin')
  if (origin === 'null') return false
  if (origin && !localOrigin(origin)) return false
  if (origin && !sameHost(origin, header(req, 'host'))) return false
  if (browserRoute && !origin) return sameOriginGet(req)
  return true
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  const host = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '')
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

function sameHost(origin: string, hostHeader: string): boolean {
  try {
    return new URL(origin).hostname.toLowerCase() === hostName(hostHeader)
  } catch {
    return false
  }
}

function hostName(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 1 ? value.slice(1, end) : ''
  }
  return value.split(':')[0] ?? ''
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

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}
