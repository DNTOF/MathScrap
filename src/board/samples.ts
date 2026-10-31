/**
 * Things to try on a blank sheet (also listed in the README). Each block is written on the
 * paper as its own formula, one under another — they all share the page's coordinate system.
 */
export const SAMPLES: { title: string; blocks: string[]; note: string }[] = [
  { title: '抛物线与直线', blocks: ['y = x^2 - 2', 'y = 0.5x + 1'], note: '两式叠在同一坐标系 · 交点、零点、极值' },
  { title: '三条曲线叠加', blocks: ['y = sin(x)', 'y = cos(x)', 'y = x/3'], note: '一张坐标系里同时看三条曲线和交点' },
  { title: '一元二次方程', blocks: ['x^2 + 2x + 1 = 0'], note: 'Δ、根、韦达定理、顶点' },
  { title: '解三角形（SAS）', blocks: ['△ABC: a = 5, b = 7, C = 60°'], note: '余弦定理 → 第三边、两角、面积、外接圆…' },
  { title: '坐标几何 + 垂直条件', blocks: ['A(0,0), B(4,0), C(1,t)', 'AC ⊥ BC'], note: '解出 t = ±√3，再推出整个三角形' },
  { title: '圆与直线', blocks: ['x^2 + y^2 - 4x + 2y = 4', 'y = x - 1'], note: '圆心半径 + 交点' },
  { title: '相交弦定理', blocks: ['⊙O: r = 5', '弦 AB、CD 交于 P, PA = 2, PB = 6, PC = 4'], note: 'PA·PB = PC·PD → PD，弦长、弦心距、圆心角' },
  { title: '中点与中位线', blocks: ['A(0,0), B(4,0), C(1,3)', 'M = 中点(A, B), N = 中点(A, C)'], note: '定义中点 → 中位线平行于第三边且等于它的一半' },
  { title: '中线还原三角形', blocks: ['△ABC: b = 4, c = 3, m_a = 2.5'], note: '由中线长反推边长 → 3-4-5 直角三角形' },
  { title: '待定系数', blocks: ['f(x) = ax^2 + bx + c', 'f(0) = 1; f(1) = 0; f(3) = 4'], note: '三个条件 → a, b, c' },
  { title: '直线过两点', blocks: ['y = kx + m, 过(1, 3), 过(2, 5)'], note: 'k = 2, m = 1' },
  { title: '平行四边形判定', blocks: ['A(0,0), B(4,0), C(5,3), D(1,3)'], note: '对边平行 → 平行四边形' },
  { title: '空间曲面', blocks: ['z = sin(x)cos(y)'], note: '3D · 自由旋转' },
  { title: '两平面交线', blocks: ['x + y + z = 3', 'x - y + 2z = 1'], note: '3D · 法向量、夹角、交线' },
  { title: '向量垂直求参数', blocks: ['𝐚 = (1, 2, 2); 𝐛 = (2, 1, k)', '𝐚 ⊥ 𝐛'], note: '3D · k = −2，叉积、夹角' },
  { title: '空间螺旋线', blocks: ['r(t) = (cos(t), sin(t), t/3)'], note: '3D 参数曲线' },
  { title: '球面', blocks: ['x^2 + y^2 + z^2 = 4'], note: '3D 隐式曲面 · 球心半径' },
]
