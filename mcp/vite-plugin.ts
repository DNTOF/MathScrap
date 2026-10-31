import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleAiProxy } from './ai-proxy.ts'
import { createBridge } from './bridge.ts'

/**
 * Dev/preview middleware: the open page and the MCP process meet on localhost.
 * Not part of the client bundle.
 */
export function mathscrapDevBridge(): Plugin {
  const bridge = createBridge()
  const middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    if (path.startsWith('/__mathscrap/bridge')) {
      void bridge.handle(req, res)
      return
    }
    if (path.startsWith('/__mathscrap/ai/')) {
      void handleAiProxy(req, res)
      return
    }
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
