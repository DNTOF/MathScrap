import { useEffect, useState, useSyncExternalStore } from 'react'
import { inkDebugStats } from './debug'
import { inkFlagsStore, type InkFlags } from './flags'

/**
 * Opt-in debug panel for the ink-feel experiments — toggles the flags live and
 * shows pointer/prediction/frame info. Never rendered unless
 * `shouldShowDebugPanel()` says so: `?ink-debug=1`, or a dev build with any
 * experiment switched on. Production without the parameter never sees it.
 */

const SWITCHES: { key: keyof InkFlags; label: string }[] = [
  { key: 'smoothing', label: '平滑（去近点+中点贝塞尔）' },
  { key: 'prediction', label: '预测显示' },
  { key: 'predictionGhost', label: '预测尾浅色渲染' },
  { key: 'capsuleEraser', label: '扫掠胶囊橡皮' },
  { key: 'pointerTolerance', label: '按指针类型容差' },
  { key: 'wetIncremental', label: '湿墨增量重绘' },
]

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <span className="opacity-60">{k}</span>
    <span className="text-right">{v}</span>
  </div>
)

export function InkDebugPanel() {
  const flags = useSyncExternalStore(inkFlagsStore.subscribe, inkFlagsStore.get)
  const [snap, setSnap] = useState(() => ({ ...inkDebugStats }))
  const [frameMs, setFrameMs] = useState(0)

  useEffect(() => {
    const poll = setInterval(() => setSnap({ ...inkDebugStats }), 250)
    // frame interval measured on the panel's own rAF — same display pipeline as the board
    let raf = 0
    let last = performance.now()
    let acc = 0
    let n = 0
    const loop = (t: number) => {
      acc += t - last
      last = t
      if (++n >= 30) {
        setFrameMs(acc / n)
        acc = 0
        n = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      clearInterval(poll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      data-no-board
      className="absolute bottom-3 left-3 z-40 w-[300px] rounded-xl border border-black/10 bg-[#f8f2e4]/95 p-3 font-mono text-[11px] leading-relaxed text-kraft-800 shadow-[0_10px_28px_rgba(60,40,20,0.25)]"
    >
      <div className="mb-1 font-bold">墨迹实验面板（?ink-debug=1）</div>
      <div className="mb-2 grid grid-cols-1 gap-1">
        {SWITCHES.map(({ key, label }) => (
          <label key={key} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={() => inkFlagsStore.set({ [key]: !flags[key] } as Partial<InkFlags>)}
              className="accent-kraft-800"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="border-t border-black/10 pt-1">
        <Row k="pointerType" v={snap.pointerType || '—'} />
        <Row k="压力" v={snap.hasPressure ? '真实压力' : '无压感（恒 0.5/0）'} />
        <Row k="getPredictedEvents" v={snap.nativePredicted ? '可用' : '不可用（自研兜底）'} />
        <Row k="预测点数" v={`${snap.predictedCount}（${snap.predictedSource}）`} />
        <Row k="move 处理耗时" v={`${snap.handlerMs.toFixed(2)} ms`} />
        <Row k="帧间隔" v={`${frameMs.toFixed(2)} ms${frameMs > 0 ? ` ≈ ${(1000 / frameMs).toFixed(0)} Hz` : ''}`} />
        <Row k="当前笔画点数" v={`${snap.strokePoints}`} />
      </div>
    </div>
  )
}
