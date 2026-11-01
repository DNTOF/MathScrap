/**
 * Polls the Vite dev bridge and runs tool calls against the open page.
 * The first request waits until after load so Playwright's networkidle can
 * settle; later polls are short and not held open.
 * Stops immediately when the page is not served by the dev bridge.
 */
export function startBrowserBridge(call: (name: string, args: Record<string, unknown>) => unknown) {
  const ac = new AbortController()
  let stop = false

  const run = async () => {
    try {
      const health = await fetch('/__mathscrap/bridge/health', { cache: 'no-store', signal: ac.signal })
      if (health.headers.get('x-mathscrap-bridge') !== '1') return
    } catch {
      return
    }
    while (!stop) {
      try {
        const res = await fetch('/__mathscrap/bridge/wait', { cache: 'no-store', signal: ac.signal })
        if (res.status === 204) {
          await sleep(1500, ac.signal)
          continue
        }
        if (!res.ok) {
          await sleep(800, ac.signal)
          continue
        }
        const job = (await res.json()) as { id?: string; name?: string; arguments?: Record<string, unknown> }
        if (!job.id || !job.name) continue
        let payload: unknown
        try {
          payload = { id: job.id, ok: true, result: call(job.name, job.arguments ?? {}) }
        } catch (e) {
          payload = { id: job.id, ok: false, error: e instanceof Error ? e.message : '工具执行失败' }
        }
        await fetch('/__mathscrap/bridge/result', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ac.signal,
        })
      } catch {
        if (stop) return
        await sleep(800, ac.signal).catch(() => undefined)
      }
    }
  }

  const start = setTimeout(() => {
    if (!stop) void run()
  }, 1200)
  return () => {
    stop = true
    clearTimeout(start)
    ac.abort()
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}
