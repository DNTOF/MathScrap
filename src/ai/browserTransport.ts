import { directTransport, type AiTransport } from './client'

/**
 * In `vite` dev and preview, the page asks the local server to forward the
 * provider request so browser CORS does not block it. A static host has no
 * forwarder; then the browser calls the provider directly.
 * The API key is a header on that request and is not logged.
 */
export function browserTransport(): AiTransport {
  const direct = directTransport()
  return {
    async request(url, init) {
      try {
        const res = await fetch('/__mathscrap/ai/forward', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }),
          signal: init.signal,
        })
        if (res.headers.get('x-mathscrap-proxy') === '1') return { status: res.status, text: await res.text() }
      } catch (e) {
        if (isAbort(e)) throw e
      }
      return direct.request(url, init)
    },
  }
}

function isAbort(e: unknown) {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}
