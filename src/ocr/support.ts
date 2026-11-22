/**
 * Which CoMER runtime this WebView can run.
 *
 * - `simd`: onnxruntime-web 1.22 (SIMD WebAssembly). Desktop, Android and iOS 16.4+.
 * - `compat`: WebKit before iOS / iPadOS 16.4 has no WASM SIMD. onnxruntime-web 1.18 is the last
 *   release with a plain `ort-wasm.wasm`; it runs the same INT8 models (decoder with a Trilu-free
 *   causal mask), several times slower. Loaded only when the SIMD probe fails, or when forced with
 *   `?ocr-compat=1` / localStorage `mathscrap.ocr-compat` = `1` for testing.
 * - `none`: no WebAssembly at all. Recognition is unavailable; ink and everything else keep working.
 */
export type OcrRuntime = 'simd' | 'compat' | 'none'

const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
const MVP_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

export const OCR_COMPAT_PARAM = 'ocr-compat'
export const OCR_COMPAT_STORAGE_KEY = 'mathscrap.ocr-compat'

interface WasmLike {
  validate?: (bytes: Uint8Array) => boolean
}

const truthy = (v: string | null | undefined) => v != null && v !== '' && !(v === '0' || v === 'false' || v === 'off')

/** Pure: choose a runtime from the probes and the dev override. */
export function pickOcrRuntime(wasm: WasmLike | undefined, forceCompat: boolean): OcrRuntime {
  const validate = (bytes: Uint8Array) => {
    try {
      return typeof wasm?.validate === 'function' && wasm.validate(bytes)
    } catch {
      return false
    }
  }
  if (!validate(MVP_PROBE)) return 'none'
  if (forceCompat) return 'compat'
  return validate(SIMD_PROBE) ? 'simd' : 'compat'
}

function forcedCompat(): boolean {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? ''
    const param = new URLSearchParams(search).get(OCR_COMPAT_PARAM)
    if (param != null) return truthy(param)
    return truthy((globalThis as { localStorage?: { getItem: (key: string) => string | null } }).localStorage?.getItem(OCR_COMPAT_STORAGE_KEY))
  } catch {
    return false
  }
}

let cached: OcrRuntime | null = null

export function ocrRuntime(): OcrRuntime {
  cached ??= pickOcrRuntime((globalThis as { WebAssembly?: WasmLike }).WebAssembly, forcedCompat())
  return cached
}

/** False only without WebAssembly. Missing SIMD falls back to the compat runtime. */
export function ocrSupported(): boolean {
  return ocrRuntime() !== 'none'
}
