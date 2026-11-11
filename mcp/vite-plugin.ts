import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleAiProxy } from './ai-proxy.ts'
import { createBridge } from './bridge.ts'
import { readBody, sendJson } from './http.ts'
import { grantSession, lanJoinAllowed, stampNavigation } from './peer.ts'
import { publishSession } from './session.ts'

/**
 * Dev/preview middleware: the open page and the MCP process meet on localhost.
 * Not part of the client bundle. The session value is not written into the page.
 */
export function mathscrapDevBridge(): Plugin {
  publishSession()
  const bridge = createBridge()
  const middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    if (path === '/__mathscrap/join') {
      void handleJoin(req, res)
      return
    }
    if (path.startsWith('/__mathscrap/bridge')) {
      void bridge.handle(req, res)
      return
    }
    if (path.startsWith('/__mathscrap/ai/')) {
      void handleAiProxy(req, res)
      return
    }
    stampNavigation(req, res)
    next()
  }
  return {
    name: 'mathscrap-dev-bridge',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

async function handleJoin(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'refused' })
    return
  }
  let share = ''
  try {
    const body = JSON.parse(await readBody(req, 4_000)) as { share?: unknown }
    share = typeof body.share === 'string' ? body.share : ''
  } catch {
    share = ''
  }
  if (!lanJoinAllowed(req, share)) {
    sendJson(res, 403, { ok: false, error: 'refused' })
    return
  }
  grantSession(res)
  sendJson(res, 200, { ok: true })
}
