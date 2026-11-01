import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { mathscrapDevBridge } from './mcp/vite-plugin.ts'

const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

/** Serve ONNX Runtime's WASM next to the page so the recognizer can load it on LAN. */
function ortRuntime(): Plugin {
  const dist = path.resolve('node_modules/onnxruntime-web/dist')
  const serve = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const url = (req.url ?? '').split('?')[0] ?? ''
    if (!url.startsWith('/ort/')) return next()
    const name = url.slice('/ort/'.length)
    if (!ORT_FILES.includes(name)) return next()
    res.statusCode = 200
    res.setHeader('content-type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
    fs.createReadStream(path.join(dist, name)).pipe(res)
  }
  return {
    name: 'ort-runtime',
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
    writeBundle(options) {
      const dir = path.join(options.dir ?? path.resolve('dist'), 'ort')
      fs.mkdirSync(dir, { recursive: true })
      for (const name of ORT_FILES) fs.copyFileSync(path.join(dist, name), path.join(dir, name))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mathscrapDevBridge(), ortRuntime()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 47321,
  },
  preview: {
    host: '0.0.0.0',
    port: 47322,
  },
  build: {
    // Plotly (~4.6 MB) is its own lazily imported chunk, loaded only when a plot opens.
    chunkSizeWarningLimit: 5000,
  },
})
