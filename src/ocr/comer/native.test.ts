/// Frontend unit tests for the opt-in native OCR switch (round 4).
/// Run: npx tsx --test src/ocr/comer/native.test.ts
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { nativeOptIn, nativeRuntimeAvailable, recognizeNative, OCR_NATIVE_PARAM, OCR_NATIVE_STORAGE_KEY } from './native.ts'
import { recognizeMath } from './web.ts'
import type { Stroke } from '../../board/types.ts'

const w = globalThis as Record<string, unknown>

function setTauri(invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  w.__TAURI__ = invoke ? { core: { invoke } } : undefined
}
function setBrowser(search: string | null, stored: string | null) {
  w.location = search === null ? undefined : { search }
  w.localStorage = stored === null ? undefined : { getItem: (k: string) => (k === OCR_NATIVE_STORAGE_KEY ? stored : null) }
}

afterEach(() => {
  delete w.__TAURI__
  delete w.location
  delete w.localStorage
})

test('opt-in parsing: URL wins over localStorage; 0/false/off clears; default off', () => {
  assert.equal(nativeOptIn('?ocr-native=1', '0'), true, 'URL wins')
  assert.equal(nativeOptIn('?ocr-native=0', '1'), false, 'explicit off wins')
  assert.equal(nativeOptIn('', '1'), true, 'localStorage opts in')
  assert.equal(nativeOptIn('', 'false'), false)
  assert.equal(nativeOptIn('', 'off'), false)
  assert.equal(nativeOptIn('', null), false, 'default off')
  assert.equal(nativeOptIn('?ocr-native=false', '1'), false)
  assert.equal(OCR_NATIVE_PARAM, 'ocr-native')
  assert.equal(OCR_NATIVE_STORAGE_KEY, 'mathscrap.ocr-native')
})

test('non-Tauri environment: native never runs, even when opted in', () => {
  setBrowser('?ocr-native=1', null)
  setTauri(undefined)
  assert.equal(nativeRuntimeAvailable(), false)
  assert.rejects(recognizeNative([]), /not running inside Tauri/)
})

test('opted-in + Tauri: the command is invoked and candidates returned', async () => {
  setBrowser('?ocr-native=1', null)
  let seen: { cmd: string; args?: Record<string, unknown> } | null = null
  setTauri(async (cmd, args) => {
    seen = { cmd, args }
    return [{ text: 'y = 2', confidence: 0.97, latex: 'y = 2' }]
  })
  assert.equal(nativeRuntimeAvailable(), true)
  const out = await recognizeNative([{ id: 's1', pts: [0, 0, 0.5, 10, 10, 0.5], color: '#000', width: 3, style: 'ink', createdAt: 0 }])
  assert.equal(seen!.cmd, 'ocr_native_recognize')
  assert.ok((seen!.args as { strokes: unknown }).strokes, 'strokes passed through')
  assert.deepEqual(out, [{ text: 'y = 2', confidence: 0.97, latex: 'y = 2' }])
})

test('recognizeMath: flag off → native command never invoked (default path unchanged)', async () => {
  setBrowser('', null)
  let invoked = false
  setTauri(async () => {
    invoked = true
    return []
  })
  // empty ink short-circuits before any runtime decision, so this only proves
  // no crash; the meaningful assertion is nativeRuntimeAvailable() === false
  assert.deepEqual(await recognizeMath([]), [])
  assert.equal(nativeRuntimeAvailable(), false)
  assert.equal(invoked, false)
})

test('recognizeMath: native failure falls back to the web runtime', async () => {
  setBrowser('?ocr-native=1', null)
  setTauri(async () => {
    throw new Error('native boom')
  })
  // formula-looking ink so the classifyInk gate passes and a runtime is chosen
  const strokes: Stroke[] = [
    { id: 's1', pts: [8, 10, 0.5, 20, 34, 0.5, 32, 12, 0.5, 34, 48, 0.5], color: '#000', width: 3, style: 'ink', createdAt: 0 },
    { id: 's2', pts: [50, 30, 0.5, 90, 32, 0.5], color: '#000', width: 3, style: 'ink', createdAt: 1 },
    { id: 's3', pts: [50, 45, 0.5, 90, 43, 0.5], color: '#000', width: 3, style: 'ink', createdAt: 2 },
  ]
  await assert.rejects(
    recognizeMath(strokes),
    (e: Error) => !e.message.includes('native boom'),
    'the rejection must come from the web fallback attempt, not the native error',
  )
})
