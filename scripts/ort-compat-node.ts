/**
 * Load the non-SIMD CoMER fallback (onnxruntime-web 1.18 `ort-wasm.wasm`) under Node for smokes.
 *
 * 1.18's web build stubs `fs`/`path`, so its Node branch cannot read the WASM. While the runtime
 * initialises, Node is hidden from Emscripten and the file is fetched from a 127.0.0.1-only
 * server, the same fetch + instantiate path WebKit takes. The browser app never uses this file.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

type Ort = typeof import('onnxruntime-web/wasm')

export const COMPAT_WASM = 'ort-wasm.wasm'

export async function loadCompatOrt(): Promise<{ ort: Ort; create: (bytes: Uint8Array) => ReturnType<Ort['InferenceSession']['create']>; close: () => void }> {
  const ort = createRequire(import.meta.url)('onnxruntime-web-nosimd/wasm') as Ort
  const wasm = readFileSync(path.resolve('node_modules/onnxruntime-web-nosimd/dist', COMPAT_WASM))
  const server = createServer((req, res) => {
    if (req.url !== `/${COMPAT_WASM}`) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('content-type', 'application/wasm')
    res.end(wasm)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = false
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = `http://127.0.0.1:${port}/`
  let ready: Promise<unknown> | null = null
  const create = async (bytes: Uint8Array) => {
    if (!ready) {
      const desc = Object.getOwnPropertyDescriptor(process.versions, 'node')!
      Object.defineProperty(process.versions, 'node', { value: undefined, configurable: true })
      ready = ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }).finally(() => Object.defineProperty(process.versions, 'node', desc))
      return ready as ReturnType<Ort['InferenceSession']['create']>
    }
    await ready.catch(() => undefined)
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
  }
  return { ort, create, close: () => server.close() }
}
