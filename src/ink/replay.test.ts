/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeTrajectory, mulberry32, replayTrajectory, type ReplayCandidate } from './replay'

test('mulberry32: deterministic and seed-sensitive', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  const seqA = Array.from({ length: 5 }, () => a())
  const seqB = Array.from({ length: 5 }, () => b())
  assert.deepEqual(seqA, seqB)
  assert.notEqual(seqA[0], mulberry32(7)())
})

test('makeTrajectory: reproducible, monotonic time, noise bounded around exact truth', () => {
  const t1 = makeTrajectory('straight', { rateHz: 60, noisePx: 0.6, seed: 42 })
  const t2 = makeTrajectory('straight', { rateHz: 60, noisePx: 0.6, seed: 42 })
  assert.deepEqual(t1.samples, t2.samples)
  assert.equal(t1.samples.length, Math.round(1500 * 0.06) + 1) // duration × rate + 1
  for (let i = 1; i < t1.samples.length; i++) assert.ok(t1.samples[i].t > t1.samples[i - 1].t)
  for (const s of t1.samples) {
    const truth = t1.truthAt(s.t)
    // ~4σ bound for a 0.6px Gaussian
    assert.ok(Math.hypot(s.x - truth.x, s.y - truth.y) < 0.6 * 4, 'sample strayed too far from truth')
  }
})

test('replayTrajectory: deterministic and counts moments', () => {
  const traj = makeTrajectory('straight', { rateHz: 60, seed: 42 })
  const cand: ReplayCandidate = { name: 'A-current-default' }
  const s1 = replayTrajectory(traj, cand, 60)
  const s2 = replayTrajectory(traj, cand, 60)
  assert.deepEqual(s1, s2)
  assert.equal(s1.predicted + s1.gated, s1.moments)
  assert.equal(s1.moments, traj.samples.length - 8)
  assert.ok(s1.predicted > s1.moments * 0.6, `straight stroke should mostly predict (got ${s1.predicted}/${s1.moments})`)
  assert.ok(s1.meanErr >= 0 && Number.isFinite(s1.meanErr))
})

test('replayTrajectory: a never-predict candidate gates everything away', () => {
  const traj = makeTrajectory('straight', { rateHz: 60, seed: 42 })
  const s = replayTrajectory(traj, { name: 'off', gate: { minSamples: 1e9 } }, 60)
  assert.equal(s.predicted, 0)
  assert.equal(s.gated, s.moments)
  assert.equal(s.meanErr, 0)
  assert.equal(s.meanOvershoot, 0)
})

test('replayTrajectory: sharp turns and pauses get gated, slow ticks mostly gated', () => {
  const turn = replayTrajectory(makeTrajectory('sharpTurn', { rateHz: 60, seed: 42 }), { name: 'A' }, 60)
  assert.ok(turn.gated > 0, 'sharp turn should suppress prediction sometimes')
  const pause = replayTrajectory(makeTrajectory('pause', { rateHz: 60, seed: 42 }), { name: 'A' }, 60)
  assert.ok(pause.gated > 0, 'paused pen should be gated (idle)')
  const tick = replayTrajectory(makeTrajectory('slowTick', { rateHz: 60, seed: 42 }), { name: 'A' }, 60)
  assert.ok(tick.predicted < tick.moments * 0.5, `slow tick should mostly stay gated (predicted ${tick.predicted}/${tick.moments})`)
})

test('replayTrajectory: candidate knobs change the outcome', () => {
  const traj = makeTrajectory('fastArc', { rateHz: 60, seed: 42 })
  const a = replayTrajectory(traj, { name: 'A' }, 60)
  const c = replayTrajectory(traj, { name: 'C', gate: { sharpTurnDeg: 75, jitterTurnDeg: 35, curveTurnDeg: 15 }, framesAhead: 2.5 }, 60)
  assert.ok(a.predicted > 0)
  // the aggressive set covers more lag → strictly larger horizon, not identical stats
  assert.notDeepEqual(a, c)
})
