import { getStroke } from 'perfect-freehand'
import type { Stroke } from './types'

function outlinePath(points: number[][]) {
  if (!points.length) return ''
  const d = points.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...points[0], 'Q'] as (string | number)[],
  )
  d.push('Z')
  return d.join(' ')
}

/** Smooth centre-line path through the stroke samples (quadratic midpoints). */
function centerPath(pts: number[]) {
  const n = pts.length / 3
  if (n === 0) return ''
  if (n === 1) return `M ${pts[0]} ${pts[1]} l 0.01 0`
  let d = `M ${pts[0]} ${pts[1]}`
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 3]
    const y = pts[i * 3 + 1]
    const nx = pts[(i + 1) * 3]
    const ny = pts[(i + 1) * 3 + 1]
    d += ` Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`
  }
  d += ` L ${pts[(n - 1) * 3]} ${pts[(n - 1) * 3 + 1]}`
  return d
}

function hasPressure(pts: number[]) {
  for (let i = 2; i < pts.length; i += 3) if (pts[i] !== 0.5 && pts[i] !== 0) return true
  return false
}

export function StrokeDefs() {
  return (
    <defs>
      <filter id="pencil-grain" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" />
      </filter>
      <pattern id="washi-stripes" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="10" height="10" fill="transparent" />
        <rect width="4" height="10" fill="rgba(255,250,240,0.55)" />
      </pattern>
    </defs>
  )
}

export function StrokeShape({ s }: { s: Stroke }) {
  const w = s.width
  switch (s.style) {
    case 'ink': {
      const pts: number[][] = []
      for (let i = 0; i < s.pts.length; i += 3) pts.push([s.pts[i], s.pts[i + 1], s.pts[i + 2]])
      const outline = getStroke(pts, { size: w * 1.6, thinning: 0.55, smoothing: 0.5, streamline: 0.45, simulatePressure: !hasPressure(s.pts) })
      return <path d={outlinePath(outline)} fill={s.color} />
    }
    case 'dashed':
      return <path d={centerPath(s.pts)} fill="none" stroke={s.color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${w * 2.6} ${w * 2.2}`} />
    case 'dotted':
      return <path d={centerPath(s.pts)} fill="none" stroke={s.color} strokeWidth={w * 1.2} strokeLinecap="round" strokeDasharray={`0 ${w * 2.4}`} />
    case 'pencil':
      return <path d={centerPath(s.pts)} fill="none" stroke={s.color} strokeWidth={Math.max(1.4, w * 0.8)} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} filter="url(#pencil-grain)" />
    case 'washi': {
      const d = centerPath(s.pts)
      return (
        <g opacity={0.82}>
          <path d={d} fill="none" stroke={s.color} strokeWidth={w * 5} strokeLinecap="butt" strokeLinejoin="round" opacity={0.75} />
          <path d={d} fill="none" stroke="url(#washi-stripes)" strokeWidth={w * 5} strokeLinecap="butt" strokeLinejoin="round" />
        </g>
      )
    }
    case 'marker':
      return <path d={centerPath(s.pts)} fill="none" stroke={s.color} strokeWidth={w * 4.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.34} style={{ mixBlendMode: 'multiply' }} />
  }
}

