/**
 * Replay-eval runner: synthetic trajectories × candidate constant sets → table.
 *
 *   npx tsx experiments/2026-11-12-ink-prediction/replay.ts
 *
 * ⚠ 全部为合成轨迹（高斯噪声 ≠ 真实笔迹）。结果只作为 iPad 实测的初值候选，
 *   本工具不修改任何默认常数。
 */
import { makeTrajectory, replayTrajectory, SCENARIO_LABELS, type ReplayCandidate, type TrajectoryScenario } from '../../src/ink/replay'

const SCENARIOS: TrajectoryScenario[] = ['straight', 'fastArc', 'sharpTurn', 'jitter', 'pause', 'slowTick']
const RATES = [60, 120]

const CANDIDATES: ReplayCandidate[] = [
  { name: 'A-现行默认' }, // gate 65/30/12, KF q=9e6 r=2, 2 frames ahead
  { name: 'B-更响应', gate: { sharpTurnDeg: 55, jitterTurnDeg: 25, curveTurnDeg: 10 }, qAcc: 2e6, measVar: 1, framesAhead: 1.5 },
  { name: 'C-更激进', gate: { sharpTurnDeg: 75, jitterTurnDeg: 35, curveTurnDeg: 15 }, qAcc: 2.5e7, measVar: 4, framesAhead: 2.5 },
  { name: 'D-更保守', gate: { sharpTurnDeg: 55, jitterTurnDeg: 25, curveTurnDeg: 14 }, qAcc: 4e6, measVar: 2, framesAhead: 1.5 },
]

console.log('=== 墨迹预测离线回放评估（合成轨迹！仅供 iPad 实测初值候选；默认值未改） ===')
console.log('噪声: 高斯 0.6px（仅加在采样上，真值精确）；窗口 96 样本；绝对时程上限 36ms；预测起点 = 第 8 个样本\n')

for (const rateHz of RATES) {
  console.log(`───────── ${rateHz}Hz（帧间隔 ${(1000 / rateHz).toFixed(1)}ms）─────────`)
  console.log(
    `${'场景'.padEnd(10)} │ ${'候选'.padEnd(11)} │ pred%  │ errMean │ errP95 │ errMax │ 过冲(±=超前/滞后)`,
  )
  for (const scenario of SCENARIOS) {
    const traj = makeTrajectory(scenario, { rateHz, noisePx: 0.6, seed: 42 })
    for (const cand of CANDIDATES) {
      const s = replayTrajectory(traj, cand, rateHz)
      const predPct = s.moments ? ((s.predicted / s.moments) * 100).toFixed(0).padStart(3) : '  0'
      console.log(
        `${SCENARIO_LABELS[scenario].padEnd(9)} │ ${cand.name.padEnd(11)} │ ${predPct}% │ ${s.meanErr.toFixed(1).padStart(6)}px │ ${s.p95Err
          .toFixed(1)
          .padStart(5)}px │ ${s.maxErr.toFixed(1).padStart(5)}px │ ${(s.meanOvershoot >= 0 ? '+' : '') + s.meanOvershoot.toFixed(2)}px`,
      )
    }
    console.log('')
  }
  // grand summary per candidate: mean err across scenarios (equal weight)
  console.log(`  [${rateHz}Hz 汇总 | 各场景等权平均 errMean]`)
  for (const cand of CANDIDATES) {
    const means = SCENARIOS.map((sc) => replayTrajectory(makeTrajectory(sc, { rateHz, noisePx: 0.6, seed: 42 }), cand, rateHz).meanErr)
    const grand = means.reduce((a, b) => a + b, 0) / means.length
    console.log(`    ${cand.name.padEnd(11)} ${grand.toFixed(2)}px`)
  }
  console.log('')
}
console.log('提醒：以上均为合成轨迹上的离线数字；候选常数只在 iPad 真机手感验证后才可能被采纳，本轮未改任何默认值。')
