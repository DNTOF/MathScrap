import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

type Call = (name: string, args: Record<string, unknown>) => unknown

interface Job {
  id: string
  name: string
  arguments?: Record<string, unknown>
}

/**
 * The installed window answers MCP calls over Tauri IPC.
 * This file does not know the session token and does not call the dev server.
 */
export function startPackagedBridge(call: Call): () => void {
  let unlisten: UnlistenFn | undefined
  let stopped = false
  void listen<Job>('mcp-call', (event) => {
    const job = event.payload
    if (!job?.id || !job.name) return
    try {
      const result = call(job.name, job.arguments ?? {})
      void invoke('mcp_result', { id: job.id, ok: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'tool failed'
      void invoke('mcp_result', { id: job.id, ok: false, error: message })
    }
  }).then((stop) => {
    if (stopped) {
      stop()
      return
    }
    unlisten = stop
    void invoke('mcp_ready')
  })
  return () => {
    stopped = true
    unlisten?.()
    void invoke('mcp_idle')
  }
}
