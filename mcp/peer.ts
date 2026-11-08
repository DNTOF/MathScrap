import type { IncomingMessage } from 'node:http'

/** Loopback peers only, unless a long share token is configured and presented. */
export function peerAllowed(req: IncomingMessage, browserOrigin: boolean): boolean {
  const remote = req.socket?.remoteAddress
  const origin = header(req, 'origin')
  if (origin && !localOrigin(origin)) return false
  if (browserOrigin && origin && !localOrigin(origin)) return false
  if (isLoopback(remote)) return true
  const token = process.env.MATHSCRAP_SHARE_TOKEN ?? ''
  if (process.env.MATHSCRAP_BIND !== 'lan' || token.length < 16) return false
  return header(req, 'x-mathscrap-share') === token
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

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}
