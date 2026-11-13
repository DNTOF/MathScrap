import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DRAG_THRESHOLD_DIP,
  HIT_TOLERANCE_DIP,
  TAP_MAX_DURATION_MS,
  dragThresholdWorld,
  hasRealPressure,
  hitToleranceWorld,
  isTapStroke,
  toPointerKind,
} from './tolerance'

test('pointer kind mapping: mouse / touch / pen, unknown → mouse', () => {
  assert.equal(toPointerKind('mouse'), 'mouse')
  assert.equal(toPointerKind('touch'), 'touch')
  assert.equal(toPointerKind('pen'), 'pen')
  assert.equal(toPointerKind(''), 'mouse')
  assert.equal(toPointerKind('fingerprint'), 'mouse')
})

test('thresholds come in the three flavours (mouse / touch / pen)', () => {
  assert.deepEqual(DRAG_THRESHOLD_DIP, { mouse: 1, touch: 16, pen: 4 })
  assert.deepEqual(HIT_TOLERANCE_DIP, { mouse: 3, touch: 10, pen: 5 })
})

test('drag threshold is DIP divided by the current zoom', () => {
  assert.equal(dragThresholdWorld('pen', 2), 2) // 4 DIP at zoom 2 → 2 world units → 4 screen px
  assert.equal(dragThresholdWorld('mouse', 4), 0.25) // tight at high zoom
  assert.equal(dragThresholdWorld('touch', 0.5), 32) // loose when zoomed out
})

test('hit tolerance is DIP divided by the current zoom', () => {
  assert.equal(hitToleranceWorld('touch', 0.5), 20)
  assert.equal(hitToleranceWorld('pen', 1), 5)
  assert.equal(hitToleranceWorld('mouse', 2), 1.5)
})

test('pressure: constant 0.5 or 0 means a pressure-less device', () => {
  assert.equal(hasRealPressure([]), false)
  assert.equal(hasRealPressure([0, 0, 0.5, 10, 10, 0.5]), false)
  assert.equal(hasRealPressure([0, 0, 0, 10, 10, 0]), false)
  assert.equal(hasRealPressure([0, 0, 0, 10, 10, 0.5]), false) // mix of 0 and 0.5 is still pressure-less
  assert.equal(hasRealPressure([0, 0, 0.5, 10, 10, 0.72]), true)
  assert.equal(hasRealPressure([0, 0, 0.12]), true)
})

test('tap detection: whole gesture inside the drag threshold', () => {
  const threshold = 4 // pen at zoom 1
  assert.equal(isTapStroke([10, 10, 0.5], threshold), true) // single point
  assert.equal(isTapStroke([10, 10, 0.5, 10.5, 10.4, 0.5, 10.9, 10.2, 0.5], threshold), true) // micro jitter
  assert.equal(isTapStroke([10, 10, 0.5, 10.5, 10.4, 0.5, 18, 12, 0.5], threshold), false) // real drag
  // exactly at the threshold counts as a drag (threshold is exclusive)
  assert.equal(isTapStroke([0, 0, 0.5, 4, 0, 0.5], 4), false)
  assert.equal(isTapStroke([0, 0, 0.5, 3.99, 0, 0.5], 4), true)
})

test('tap detection requires short displacement AND a quick press', () => {
  const threshold = 4
  const microJitter = [10, 10, 0.5, 10.5, 10.4, 0.5, 10.9, 10.2, 0.5]
  // quick press inside the threshold → tap
  assert.equal(isTapStroke(microJitter, threshold, 80), true)
  // same tiny displacement but the pen rested: a deliberate tick stays a stroke
  assert.equal(isTapStroke(microJitter, threshold, 400), false)
  // boundary is inclusive on the duration
  assert.equal(isTapStroke(microJitter, threshold, TAP_MAX_DURATION_MS), true)
  assert.equal(isTapStroke(microJitter, threshold, TAP_MAX_DURATION_MS + 1), false)
  // quick but beyond the drag threshold → drag, not tap
  assert.equal(isTapStroke([0, 0, 0.5, 8, 0, 0.5], threshold, 50), false)
  // no duration given → old displacement-only rule
  assert.equal(isTapStroke(microJitter, threshold), true)
})
