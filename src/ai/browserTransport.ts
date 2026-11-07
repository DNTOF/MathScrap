import { directTransport, type AiTransport } from './client'

/**
 * In `vite` dev and preview, the page asks the local server to forward the
 * provider request so browser CORS does not block it. A static host has no
 * forwarder; then the browser calls the provider directly.
 * The API key is a header on that request and is not logged.
 */
export function browserTransport(): AiTransport {
  const direct = directTransport()
  // The packaged shell has no Vite forwarder. Call the address the person typed.
  // The forwarder module is imported only for dev, so the production bundle does not name it.
  if (import.meta.env.PROD) return direct
  return {
    async request(url, init) {
      const { forwardThroughDevServer } = await import('./browserForward')
      return forwardThroughDevServer(direct, url, init)
    },
  }
}
