import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const dist = path.join(root, 'dist')
const lines = []

function fail(message) {
  console.error(`verify-packaged-dist: ${message}`)
  process.exit(1)
}

function need(rel, minBytes) {
  const file = path.join(dist, rel)
  if (!existsSync(file)) fail(`missing ${rel}`)
  const size = statSync(file).size
  if (size < minBytes) fail(`${rel} is ${size} bytes, expected at least ${minBytes}`)
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
  lines.push(`${sha}  ${rel}  ${size}`)
}

if (!existsSync(dist)) fail('dist/ is missing. Run npm run build first. This check does not start Vite.')

need('index.html', 100)
need('models/comer/encoder_int8.onnx', 1_000_000)
need('models/comer/decoder_int8.onnx', 1_000_000)
need('models/comer/decoder_int8_compat.onnx', 1_000_000)
need('models/comer/vocab.json', 100)
need('models/comer/LICENSE', 100)
need('models/comer/NOTICE.md', 50)
need('favicon.png', 50)

const ortDir = path.join(dist, 'ort')
if (!existsSync(ortDir)) fail('dist/ort is missing. ONNX Runtime WASM was not copied into the bundle.')
const ort = readdirSync(ortDir)
for (const name of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  if (!ort.includes(name)) fail(`dist/ort/${name} was not bundled`)
  need(path.posix.join('ort', name), name.endsWith('.wasm') ? 1_000_000 : 100)
}
if (!ort.some((name) => name === 'ort-wasm-simd.wasm')) {
  console.log('note: ort-wasm-simd.wasm (non-threaded) is not in this onnxruntime-web build; the threaded file is the one the page requests with numThreads = 1')
}

// non-SIMD fallback (onnxruntime-web 1.18) for WebKit before iOS / iPadOS 16.4
need('ort-compat/ort-wasm.wasm', 1_000_000)

const assets = path.join(dist, 'assets')
const wasm = existsSync(assets) ? readdirSync(assets).filter((name) => name.endsWith('.wasm')) : []
if (!wasm.length) fail('mathcore WASM was not emitted under dist/assets')
for (const name of wasm) need(path.posix.join('assets', name), 100_000)

const html = readFileSync(path.join(dist, 'index.html'), 'utf8')
if (/47321|47322|fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|esm\.sh/.test(html)) fail('index.html points at the dev server or a CDN')
if (/<script[^>]+src="https?:/.test(html) || /<link[^>]+href="https?:/.test(html)) fail('index.html loads a remote script or stylesheet')

const banned = /__mathscrap\/bridge|__mathscrap\/ai\/forward|localhost:47321|127\.0\.0\.1:47321/
const jsFiles = readdirSync(assets).filter((name) => name.endsWith('.js'))
for (const name of jsFiles) {
  const text = readFileSync(path.join(assets, name), 'utf8')
  if (banned.test(text)) fail(`dist/assets/${name} still references the Vite dev bridge`)
}

console.log('verify-packaged-dist ok')
console.log(lines.join('\n'))
