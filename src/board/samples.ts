import { TAPES, uid, type Card, type Doc, type Stroke } from './types'

/** Formulas that work out of the box (also listed in the README). */
export const SAMPLES: { title: string; text: string; note: string }[] = [
  { title: '抛物线与直线交点', text: 'y = x^2 - 2\ny = 0.5x + 1', note: '2D · 交点、零点、极值' },
  { title: '解三角形（SAS）', text: '△ABC: a = 5, b = 7, C = 60°', note: '余弦定理 → 第三边、两角、面积、外接圆…' },
  { title: '坐标几何 + 垂直条件', text: 'A(0,0), B(4,0), C(1,t)\nAC ⊥ BC', note: '解出 t = ±√3，再推出整个三角形' },
  { title: '空间曲面', text: 'z = sin(x)cos(y)', note: '3D · 自由旋转' },
  { title: '两平面交线', text: 'x + y + z = 3\nx - y + 2z = 1', note: '3D · 法向量、夹角、交线' },
  { title: '待定系数', text: 'f(x) = ax^2 + bx + c\nf(0) = 1; f(1) = 0; f(3) = 4', note: '三个条件 → a, b, c' },
  { title: '向量垂直求参数', text: '𝐚 = (1, 2, 2); 𝐛 = (2, 1, k)\n𝐚 ⊥ 𝐛', note: '3D · k = −2，叉积、夹角' },
  { title: '圆与直线', text: 'x^2 + y^2 - 4x + 2y = 4\ny = x - 1', note: '识别圆心半径 + 交点' },
  { title: '平行四边形判定', text: 'A(0,0), B(4,0), C(5,3), D(1,3)', note: '对边平行 → 平行四边形' },
  { title: '直线过两点', text: 'y = kx + b, 过(1, 3), 过(2, 5)', note: 'k = 2, b = 1' },
  { title: '空间螺旋线', text: 'r(t) = (cos(t), sin(t), t/3)', note: '3D 参数曲线' },
  { title: '球面', text: 'x^2 + y^2 + z^2 = 4', note: '3D 隐式曲面 · 球心半径' },
]

function card(text: string, x: number, y: number, i: number): Card {
  return { id: uid(), text, x, y, rot: [-1.6, 1.1, -0.6, 1.8, -1.2, 0.7, -0.4, 1.4][i % 8], tape: TAPES[i % TAPES.length] }
}

function wavy(x0: number, y0: number, len: number, color: string, width: number): Stroke {
  const pts: number[] = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    pts.push(x0 + t * len, y0 + Math.sin(t * Math.PI * 5) * 3 + t * 2, 0.5)
  }
  return { id: uid(), pts, color, width, style: 'ink', createdAt: Date.now() }
}

function arrow(x0: number, y0: number, x1: number, y1: number, color: string): Stroke[] {
  const pts: number[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const bend = Math.sin(t * Math.PI) * 26
    pts.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - bend, 0.5)
  }
  const ang = Math.atan2(y1 - y0, x1 - x0)
  const head = (da: number) => [x1, y1, 0.5, x1 - 16 * Math.cos(ang + da), y1 - 16 * Math.sin(ang + da), 0.5]
  return [
    { id: uid(), pts, color, width: 3, style: 'dashed', createdAt: Date.now() },
    { id: uid(), pts: head(0.5), color, width: 3, style: 'ink', createdAt: Date.now() },
    { id: uid(), pts: head(-0.5), color, width: 3, style: 'ink', createdAt: Date.now() },
  ]
}

export function sampleDoc(): Doc {
  const picks = [0, 1, 2, 3, 4, 5, 6, 7]
  const cols = 4
  const cards = picks.map((p, i) => card(SAMPLES[p].text, 60 + (i % cols) * 360, 170 + Math.floor(i / cols) * 270, i))
  return {
    cards,
    stickers: [
      { id: uid(), x: 60, y: 40, text: '数学手账 · 第 1 页', size: 46, rot: -1.5 },
      { id: uid(), x: 1080, y: 58, text: '点卡片右下角的小图表 → 看图 + 推导', size: 26, rot: 1.2 },
    ],
    strokes: [wavy(64, 104, 330, '#9b3b2a', 4), ...arrow(1240, 112, 1300, 160, '#2f4a6d')],
  }
}
