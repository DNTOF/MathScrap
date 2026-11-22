/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hitSweep, segSegDist2 } from './capsule'
import type { Stroke } from '@/board/types'

const strokeOf = (pts: number[], width = 4, style: Stroke['style'] = 'ink'): Stroke => ({
  id: 's1',
  pts,
  color: '#000',
  width,
  style,
  createdAt: 0,
})

test('capsule catches what the point test misses during fast motion', () => {
  // a vertical stroke at x=100 (the same segment-distance rule the main eraser
  // applies per pointer event, tested from the two event positions)
  const stroke = strokeOf([100, 0, 0.5, 100, 200, 0.5])
  const r = 12
  const e1 = { x: 40, y: 50 }
  const e2 = { x: 160, y: 50 }
  // both pointer events sit 60 px away from the stroke → point tests miss
  assert.ok(segSegDist2(e1, e1, { x: 100, y: 0 }, { x: 100, y: 200 }) > r * r)
  assert.ok(segSegDist2(e2, e2, { x: 100, y: 0 }, { x: 100, y: 200 }) > r * r)
  // the swept capsule between them crosses the stroke → hit
  assert.equal(hitSweep(stroke, e1.x, e1.y, e2.x, e2.y, r), true)
})

test('capsule degenerates to a disc for a stationary eraser', () => {
  const stroke = strokeOf([0, 0, 0.5, 50, 0, 0.5])
  // tip 13 px above the line: radius 12 (+3.2 width pad → 15.2) → hit; radius 8 (+3.2 → 11.2) → miss
  assert.equal(hitSweep(stroke, 25, 13, 25, 13, 12), true)
  assert.equal(hitSweep(stroke, 25, 13, 25, 13, 8), false)
})

test('capsule keeps the same width padding as hitStroke', () => {
  // vertical stroke at x=100, radius 12 → ink pad = 4*0.8 = 3.2 → reach 15.2
  const ink = strokeOf([100, 0, 0.5, 100, 100, 0.5], 4, 'ink')
  assert.equal(hitSweep(ink, 85, 10, 85, 90, 12), true) // 15 ≤ 15.2
  assert.equal(hitSweep(ink, 84, 10, 84, 90, 12), false) // 16 > 15.2
  // marker pad = 10*2.5 = 25 → reach 37
  const marker = strokeOf([100, 0, 0.5, 100, 100, 0.5], 10, 'marker')
  assert.equal(hitSweep(marker, 64, 10, 64, 90, 12), true) // 36 ≤ 37
  assert.equal(hitSweep(marker, 62, 10, 62, 90, 12), false) // 38 > 37
})

test('capsule hits single-point strokes and later segments', () => {
  const dot = strokeOf([500, 500, 0.5])
  assert.equal(hitSweep(dot, 495, 495, 494, 494, 12), true)
  const multi = strokeOf([0, 0, 0.5, 30, 30, 0.5, 60, 0, 0.5])
  // sweep passing only over the second segment
  assert.equal(hitSweep(multi, 40, 5, 50, 5, 12), true)
  // well below the V shape → no segment within reach (width 4 → reach 9.2)
  assert.equal(hitSweep(multi, 45, 40, 55, 40, 6), false)
})

test('capsule: empty stroke never hits', () => {
  assert.equal(hitSweep(strokeOf([]), 0, 0, 50, 50, 12), false)
})
