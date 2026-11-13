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

/**
 * Non-SIMD fallback for WebKit before iOS / iPadOS 16.4: onnxruntime-web 1.18's plain `ort-wasm.wasm`
 * (npm alias `onnxruntime-web-nosimd`). Fetched only when the SIMD probe fails or `?ocr-compat=1`.
 */
const ORT_COMPAT_FILES = ['ort-wasm.wasm']

/** Serve ONNX Runtime's WASM next to the page so the recognizer can load it on LAN. */
function ortRuntime(): Plugin {
  const dist = path.resolve('node_modules/onnxruntime-web/dist')
  const compatDist = path.resolve('node_modules/onnxruntime-web-nosimd/dist')
  const files = () => ortFilesIn(dist)
  const serve = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const url = (req.url ?? '').split('?')[0] ?? ''
    let file: string | null = null
    if (url.startsWith('/ort/')) {
      const name = url.slice('/ort/'.length)
      if (files().includes(name)) file = path.join(dist, name)
    } else if (url.startsWith('/ort-compat/')) {
      const name = url.slice('/ort-compat/'.length)
      if (ORT_COMPAT_FILES.includes(name)) file = path.join(compatDist, name)
    }
    if (!file) return next()
    res.statusCode = 200
    res.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
    fs.createReadStream(file).pipe(res)
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
      const out = options.dir ?? path.resolve('dist')
      const dir = path.join(out, 'ort')
      fs.mkdirSync(dir, { recursive: true })
      for (const name of files()) fs.copyFileSync(path.join(dist, name), path.join(dir, name))
      const compat = path.join(out, 'ort-compat')
      fs.mkdirSync(compat, { recursive: true })
      for (const name of ORT_COMPAT_FILES) fs.copyFileSync(path.join(compatDist, name), path.join(compat, name))
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
    // iOS builds run in WKWebView down to iPadOS 15, so lower syntax and CSS for Safari 15 there.
    // Other platforms keep Vite's default target. Tauri sets TAURI_ENV_PLATFORM for beforeBuildCommand.
    ...(process.env.TAURI_ENV_PLATFORM === 'ios' ? { target: ['es2020', 'safari15'], cssTarget: ['safari15'] } : {}),
    // Plotly (~4.6 MB) is its own lazily imported chunk, loaded only when a plot opens.
    chunkSizeWarningLimit: 5000,
  },
})
