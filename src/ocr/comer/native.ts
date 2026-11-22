/**
 * Opt-in native OCR runtime (Tauri backend, round 3).
 *
 * Two gates must both hold before ink reaches the native command:
 *   1. the user opted in — `?ocr-native=1` (URL) or
 *      `localStorage mathscrap.ocr-native = 1` — mirroring the ocr-compat switch;
 *   2. the page runs inside Tauri (`window.__TAURI__`).
 * Anything else — or any native failure — falls back to the unchanged
 * onnxruntime-web path in web.ts.
 */
import type { Stroke } from '../../board/types.ts'
import type { OcrCandidate } from './engine.ts'
import { toInk } from './web.ts'

export const OCR_NATIVE_PARAM = 'ocr-native'
export const OCR_NATIVE_STORAGE_KEY = 'mathscrap.ocr-native'

const truthy = (v: string | null | undefined) => v != null && v !== '' && !(v === '0' || v === 'false' || v === 'off')

/** Pure: opt-in resolution. URL param wins, then localStorage; default off. */
export function nativeOptIn(search: string | null, stored: string | null): boolean {
  if (search != null) {
    const param = new URLSearchParams(search).get(OCR_NATIVE_PARAM)
    if (param != null) return truthy(param)
  }
  return truthy(stored)
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function tauriInvoke(): TauriInvoke | null {
  const w = globalThis as { __TAURI__?: { core?: { invoke?: TauriInvoke }; invoke?: TauriInvoke } }
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? null
}

/** Both gates: explicit opt-in AND a Tauri backend to talk to. */
export function nativeRuntimeAvailable(): boolean {
  try {
    const search = typeof location !== 'undefined' ? location.search : null
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(OCR_NATIVE_STORAGE_KEY) : null
    return nativeOptIn(search, stored) && tauriInvoke() != null
  } catch {
    return false
  }
}

/** Native candidates through the Tauri command. Throws when unavailable/failed. */
export async function recognizeNative(strokes: Stroke[]): Promise<OcrCandidate[]> {
  const invoke = tauriInvoke()
  if (!invoke) throw new Error('native OCR: not running inside Tauri')
  const ink = toInk(strokes)
  if (!ink.length) return []
  const out = await invoke('ocr_native_recognize', { strokes: ink })
  return out as OcrCandidate[]
}

// re-exported for the pure opt-in test
export { nativeOptIn as _nativeOptIn }
