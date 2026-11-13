/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseInkFlags, DEFAULT_INK_FLAGS, INK_FLAGS_STORAGE_KEY, createInkFlagsStore, shouldShowDebugPanel, type InkFlags } from './flags'

const ALL_OFF: InkFlags = {
  smoothing: false,
  prediction: false,
  predictionGhost: false,
  capsuleEraser: false,
  pointerTolerance: false,
  wetIncremental: false,
}

test('flags: defaults are all off', () => {
  assert.deepEqual(parseInkFlags('', null), ALL_OFF)
  assert.deepEqual(DEFAULT_INK_FLAGS, ALL_OFF)
})

test('flags: persisted JSON (partial) is honoured', () => {
  const stored = JSON.stringify({ smoothing: true })
  assert.deepEqual(parseInkFlags('', stored), { ...ALL_OFF, smoothing: true })
})

test('flags: URL params override the store; 0/false clears', () => {
  const stored = JSON.stringify({ smoothing: true, prediction: true })
  assert.deepEqual(parseInkFlags('?ink-smooth=0&ink-capsule=1', stored), { ...ALL_OFF, prediction: true, capsuleEraser: true })
  assert.deepEqual(parseInkFlags('?ink-predict=1&ink-tolerance=1&ink-ghost=1&ink-wet-inc=1', null), {
    ...ALL_OFF,
    prediction: true,
    pointerTolerance: true,
    predictionGhost: true,
    wetIncremental: true,
  })
  assert.equal(parseInkFlags('?ink-smooth=false', null).smoothing, false)
})

test('flags: broken store falls back to defaults, URL still applies', () => {
  assert.deepEqual(parseInkFlags('?ink-smooth=1', '{oops'), { ...ALL_OFF, smoothing: true })
})

test('flags: unknown keys and junk values are ignored', () => {
  const stored = JSON.stringify({ smoothing: true, evil: 'x', prediction: 'yes' })
  assert.deepEqual(parseInkFlags('', stored), { ...ALL_OFF, smoothing: true })
})

test('flags: the storage key is stable', () => {
  assert.equal(INK_FLAGS_STORAGE_KEY, 'mathscrap.ink-flags.v1')
})

test('flags store: get is stable, set merges + notifies + persists', () => {
  let persisted: InkFlags | null = null
  const store = createInkFlagsStore({ ...ALL_OFF }, (f) => (persisted = { ...f }))
  const a = store.get()
  assert.deepEqual(a, ALL_OFF)
  assert.equal(store.get(), a) // stable identity between sets (useSyncExternalStore-safe)

  let notified = 0
  const unsub = store.subscribe(() => notified++)
  store.set({ smoothing: true })
  assert.equal(notified, 1)
  assert.deepEqual(store.get(), { ...ALL_OFF, smoothing: true })
  assert.notEqual(store.get(), a) // new identity after set
  assert.deepEqual(persisted, store.get())

  store.set({ prediction: true, smoothing: false })
  assert.equal(notified, 2)
  assert.deepEqual(store.get(), { ...ALL_OFF, prediction: true })

  unsub()
  store.set({ capsuleEraser: true })
  assert.equal(notified, 2) // no notification after unsubscribe
  assert.equal(store.get().capsuleEraser, true)
})

test('flags store: persist throwing is swallowed', () => {
  const store = createInkFlagsStore(
    { ...ALL_OFF },
    () => {
      throw new Error('no storage')
    },
  )
  assert.doesNotThrow(() => store.set({ smoothing: true }))
  assert.equal(store.get().smoothing, true)
})

test('debug panel gating: explicit param wins, otherwise dev + any flag on', () => {
  const on = { ...ALL_OFF, smoothing: true }
  assert.equal(shouldShowDebugPanel('?ink-debug=1', false, ALL_OFF), true) // explicit param even in prod
  assert.equal(shouldShowDebugPanel('?ink-debug=0', true, on), false) // explicit hide wins
  assert.equal(shouldShowDebugPanel('', true, on), true) // dev + experiment on
  assert.equal(shouldShowDebugPanel('', true, ALL_OFF), false) // dev but nothing on
  assert.equal(shouldShowDebugPanel('', false, on), false) // prod without param
})
