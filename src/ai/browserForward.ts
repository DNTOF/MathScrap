import type { AiTransport } from './client'

/** Dev-server only. Production builds do not import this module. */
export async function forwardThroughDevServer(
  direct: AiTransport,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch('/__mathscrap/ai/forward', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }),
      signal: init.signal,
    })
    if (res.headers.get('x-mathscrap-proxy') === '1') return { status: res.status, text: await res.text() }
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw e
  }
  return direct.request(url, init)
}
