import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { mathscrapDevBridge } from './mcp/vite-plugin.ts'

/** SIMD WASM shipped inside the app. JSEP/WebGPU builds are not the CoMER path. */
function ortFilesIn(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => {
    if (!/^ort-wasm-simd.*\.(wasm|mjs)$/.test(name)) return false
    if (name.includes('jsep') || name.includes('asyncify')) return false
    return true
  })
}

/** Serve ONNX Runtime's WASM next to the page so the recognizer can load it on LAN. */
function ortRuntime(): Plugin {
  const dist = path.resolve('node_modules/onnxruntime-web/dist')
  const files = () => ortFilesIn(dist)
  const serve = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const url = (req.url ?? '').split('?')[0] ?? ''
    if (!url.startsWith('/ort/')) return next()
    const name = url.slice('/ort/'.length)
    if (!files().includes(name)) return next()
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
      for (const name of files()) fs.copyFileSync(path.join(dist, name), path.join(dir, name))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mathscrapDevBridge(), ortRuntime()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: process.env.MATHSCRAP_BIND === 'lan' ? '0.0.0.0' : '127.0.0.1',
    port: 47321,
  },
  preview: {
    host: process.env.MATHSCRAP_BIND === 'lan' ? '0.0.0.0' : '127.0.0.1',
    port: 47322,
  },
  build: {
    // Plotly (~4.6 MB) is its own lazily imported chunk, loaded only when a plot opens.
    chunkSizeWarningLimit: 5000,
  },
})
