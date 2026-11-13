/**
 * The CoMER runtime (onnxruntime-web 1.22) ships only SIMD WebAssembly builds.
 * WebKit before iOS / iPadOS 16.4 has no WASM SIMD, so recognition is unavailable
 * there while ink and the math engine keep working. Probe once with a tiny module.
 */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])

let cached: boolean | null = null

export function ocrSupported(): boolean {
  if (cached !== null) return cached
  let ok = false
  try {
    const wasm = (globalThis as { WebAssembly?: { validate?: (bytes: Uint8Array) => boolean } }).WebAssembly
    ok = typeof wasm?.validate === 'function' && wasm.validate(SIMD_PROBE)
  } catch {
    ok = false
  }
  cached = ok
  return ok
}