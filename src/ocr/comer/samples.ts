import type { InkStroke, StrokePoint } from './preprocess.ts'

/** Synthetic pen strokes used by `npm run ocr:live` and the sheet check. */
export function inkFixtures(width = 3): { name: string; expect: RegExp; strokes: InkStroke[] }[] {
  const y = [
    line(
      [
        [22, 18],
        [44, 64],
      ],
      width,
    ),
    line(
      [
        [66, 16],
        [48, 58],
        [40, 92],
        [30, 118],
      ],
      width,
    ),
  ]
  const eq = [
    line(
      [
        [150, 70],
        [198, 68],
      ],
      width,
    ),
    line(
      [
        [150, 92],
        [198, 94],
      ],
      width,
    ),
  ]
  const two = line(
    [
      [230, 52],
      [248, 28],
      [276, 26],
      [290, 44],
      [272, 66],
      [230, 100],
      [218, 122],
      [294, 124],
    ],
    width,
  )
  const ex = [
    line(
      [
        [230, 46],
        [274, 90],
      ],
      width,
    ),
    line(
      [
        [270, 48],
        [226, 88],
      ],
      width,
    ),
  ]
  const a = [circle(40, 86, 24, width), line([[62, 64], [64, 112]], width)]
  const sup = line(
    [
      [86, 36],
      [98, 22],
      [114, 22],
      [120, 36],
      [106, 50],
      [88, 62],
      [82, 72],
      [118, 74],
    ],
    Math.max(2, width * 0.65),
  )
  const b = [
    line(
      [
        [228, 28],
        [230, 136],
      ],
      width,
    ),
    circle(256, 108, 22, width),
  ]
  const one = line(
    [
      [36, 18],
      [36, 72],
    ],
    width,
  )
  const bar = line(
    [
      [10, 90],
      [78, 90],
    ],
    width,
  )
  const twoSmall = line(
    [
      [22, 108],
      [40, 98],
      [62, 108],
      [54, 128],
      [24, 150],
      [18, 162],
      [66, 164],
    ],
    width,
  )
  return [
    { name: 'y-eq-2', expect: /^y = 2$/, strokes: [...y, ...eq, two] },
    { name: 'y-eq-x', expect: /^y = x$/, strokes: [...y, ...eq, ...ex] },
    { name: 'a2-eq-b', expect: /^a\^2 = b$/, strokes: [...a, sup, ...eq, ...b] },
    { name: 'frac', expect: /^\(1\)\/\(2\)$/, strokes: [one, bar, twoSmall] },
  ]
}

/** Five letter-sized marks on one baseline: a note, not a formula. */
export function proseNote(width = 3): InkStroke[] {
  const out: InkStroke[] = []
  for (let i = 0; i < 5; i++) {
    const x = i * 42
    out.push(
      line(
        [
          [x + 2, 36],
          [x + 10, 8],
          [x + 18, 34],
          [x + 26, 12],
          [x + 34, 36],
        ],
        width,
      ),
    )
  }
  return out
}

/**
 * Capital A and two digits the model already reads as 2, with parentheses.
 * Live check: `A(2, 2)`.
 */
export function pointPair(width = 3): InkStroke[] {
  const two = (dx: number) =>
    line(
      [
        [230, 52],
        [248, 28],
        [276, 26],
        [290, 44],
        [272, 66],
        [230, 100],
        [218, 122],
        [294, 124],
      ].map(([x, y]) => [dx + (x - 230) * 0.85, 4 + (y - 20) * 0.85]),
      width,
    )
  const arc = (cx: number, a0: number, a1: number) => {
    const pts: number[][] = []
    for (let i = 0; i <= 16; i++) {
      const t = a0 + ((a1 - a0) * i) / 16
      pts.push([cx + 16 * Math.cos(t), 58 + 34 * Math.sin(t)])
    }
    return line(pts, width)
  }
  return [
    line(
      [
        [8, 90],
        [36, 18],
        [64, 90],
      ],
      width,
    ),
    line(
      [
        [20, 58],
        [50, 58],
      ],
      width,
    ),
    arc(100, Math.PI * 0.5, Math.PI * 1.55),
    two(150),
    line(
      [
        [250, 62],
        [258, 78],
        [248, 92],
      ],
      width,
    ),
    two(290),
    arc(400, -Math.PI * 0.55, Math.PI * 0.55),
  ]
}

/** The same bowl the model already reads as `a`, with a bar across the top. */
export function arrowLetter(width = 3): InkStroke[] {
  return [
    circle(40, 86, 24, width),
    line(
      [
        [62, 64],
        [64, 112],
      ],
      width,
    ),
    line(
      [
        [8, 28],
        [92, 26],
      ],
      width,
    ),
  ]
}

export function shiftInk(strokes: InkStroke[], dx: number, dy: number): InkStroke[] {
  return strokes.map((s) => ({ points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), lineWidth: s.lineWidth }))
}

function line(pts: number[][], lineWidth: number): InkStroke {
  return { points: pts.map(([x, y]) => ({ x, y })), lineWidth }
}

function circle(cx: number, cy: number, r: number, lineWidth: number, n = 28): InkStroke {
  const points: StrokePoint[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    points.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) })
  }
  return { points, lineWidth }
}
