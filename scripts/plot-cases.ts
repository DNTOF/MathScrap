/** Formula cases shared by the Node smoke test and the browser plot test. */
import { SAMPLES } from '../src/board/samples'

export interface Expect {
  dim?: 2 | 3
  kinds?: string[]
  /** substrings that must appear in some fact "label = value" (LaTeX) */
  facts?: string[]
  /** unknown → value */
  solve?: Record<string, number>
  /** x-values that must be marked as equation roots */
  roots?: number[]
  /** points that must be inside the initial 2D window */
  inView?: [number, number][]
  error?: RegExp
  minFacts?: number
}

export const cases: [string, string, Expect][] = [
  // ---- equations in x (the reported bug) and other plane curves ----
  ['方程 · 重根抛物线', 'x^2+2x+1=0', { dim: 2, kinds: ['equation1'], roots: [-1], facts: ['\\Delta=0', 'x_1 = x_2=-1'], inView: [[-1, 0], [0, 1]] }],
  ['方程 · 两实根', 'x^2 - 4 = 0', { dim: 2, kinds: ['equation1'], roots: [-2, 2], inView: [[-2, 0], [2, 0], [0, -4]] }],
  ['方程 · 无实根', 'x^2 + 1 = 0', { dim: 2, kinds: ['equation1'], roots: [], facts: ['\\pm'], inView: [[0, 1]] }],
  ['方程 · 一次', '2x + 3 = 7', { dim: 2, kinds: ['equation1'], roots: [2] }],
  ['方程 · 三次（数值）', 'x^3 - x = 0', { dim: 2, kinds: ['equation1'], roots: [-1, 0, 1] }],
  ['方程 · 两边都有 x', 'x^2 = 2x + 3', { dim: 2, kinds: ['equation1'], roots: [-1, 3] }],
  ['竖直直线 x = 2', 'x = 2', { dim: 2, kinds: ['implicit2'] }],
  ['抛物线 y = x² − 2', 'y = x^2 - 2', { dim: 2, kinds: ['curve'], inView: [[0, -2], [-1.414, 0], [1.414, 0]] }],
  ['抛物线 y = x² + 2x + 1', 'y = x^2 + 2x + 1', { dim: 2, kinds: ['curve'], inView: [[-1, 0], [0, 1]] }],
  ['三次函数', 'f(x) = x^3 - 3x', { dim: 2, inView: [[-1, 2], [1, -2], [0, 0]] }],
  ['正弦', 'y = sin(x)', { dim: 2, inView: [[Math.PI / 2, 1], [-Math.PI / 2, -1]] }],
  ['指数', 'y = e^x', { dim: 2, inView: [[0, 1]] }],
  ['对数', 'y = ln(x)', { dim: 2, inView: [[1, 0]] }],
  ['反比例', 'y = 1/x', { dim: 2, facts: ['x \\ne 0'] }],
  ['常函数', 'y = 3', { dim: 2, inView: [[0, 3]] }],
  ['直线（隐式）', 'x + y = 1', { dim: 2, kinds: ['implicit2'], inView: [[1, 0], [0, 1]] }],
  ['圆', 'x^2 + y^2 = 4', { dim: 2, facts: ['r=2'], inView: [[2, 0], [-2, 0], [0, 2]] }],
  ['椭圆', 'x^2/9 + y^2/4 = 1', { dim: 2, inView: [[3, 0], [0, 2]] }],
  ['双曲线', 'x^2 - y^2 = 1', { dim: 2, inView: [[1, 0], [-1, 0]] }],
  ['抛物线（隐式）', 'y^2 = 4x', { dim: 2, inView: [[0, 0], [1, 2]] }],
  // ---- intersections ----
  ['抛物线 ∩ 直线', 'y = x^2 - 2\ny = 0.5x + 1', { dim: 2, facts: ['P_{1}', 'P_{2}'], inView: [[-1.5, 0.25], [2, 2]] }],
  ['圆 ∩ 直线', 'x^2 + y^2 - 4x + 2y = 4\ny = x - 1', { dim: 2, inView: [[2, -1]] }],
  ['两函数交点', 'y = x^2\ny = 2 - x^2', { dim: 2, inView: [[1, 1], [-1, 1]] }],
  // ---- unknowns ----
  ['待定系数', 'f(x) = ax^2 + bx + c\nf(0) = 1; f(1) = 0; f(3) = 4', { solve: { a: 1, b: -2, c: 1 } }],
  ['直线过两点', 'y = kx + b, 过(1, 3), 过(2, 5)', { solve: { k: 2, b: 1 } }],
  // ---- triangles / coordinate geometry ----
  ['解三角形 SAS', '△ABC: a = 5, b = 7, C = 60°', { dim: 2, facts: ['\\sqrt{39}'], minFacts: 10 }],
  ['解三角形 SSS', '△ABC: a=3, b=4, c=5', { dim: 2, facts: ['90', 'S_{\\text{海伦}}', '|OI|', 'r_a=', 'AF_{c}', '\\Pi_{\\text{Ceva}}', '\\Pi_{\\text{Menelaus}}'], minFacts: 22 }],
  ['解三角形 SSA 两解', '△ABC: a = 6, b = 8, A = 40°', { dim: 2 }],
  ['坐标 + 垂直', 'A(0,0), B(4,0), C(1,t)\nAC ⊥ BC', { dim: 2, solve: { t: Math.sqrt(3) }, inView: [[0, 0], [4, 0]] }],
  ['平行四边形', 'A(0,0), B(4,0), C(5,3), D(1,3)', { dim: 2, facts: ['平行四边形'], inView: [[5, 3]] }],
  // ---- vectors (bold names) ----
  ['平面向量（粗体）', '𝐚 = (3, 4); 𝐛 = (4, -3)', { dim: 2, kinds: ['vector', 'vector'], facts: ['\\mathbf{a}'], inView: [[3, 4], [4, -3]] }],
  ['向量平行求参数', '**a** = (1, 2); **b** = (2, k)\n**a** ∥ **b**', { dim: 2, solve: { k: 4 } }],
  ['空间向量垂直求参数', '𝐚 = (1, 2, 2); 𝐛 = (2, 1, k)\n𝐚 ⊥ 𝐛', { dim: 3, solve: { k: -2 } }],
  ['\\vec 写法', '\\vec{u} = (1, 0, 0); \\mathbf{v} = (0, 1, 0)', { dim: 3, kinds: ['vector', 'vector'] }],
  ['线段向量 AB', 'AB = (3, 4)', { dim: 2, kinds: ['vector'] }],
  ['向量模长条件', '𝐚 = (3, t)\n|𝐚| = 5', { solve: { t: 4 } }],
  // ---- circles: intersecting chords, secants, tangent, circle × points ----
  ['相交弦定理', '⊙O: r = 5\n弦 AB、CD 交于 P, PA = 2, PB = 6, PC = 4', { dim: 2, facts: ['PD', 'd(O, AB)', '圆周角'], minFacts: 12 }],
  ['割线定理', '⊙O: r = 5\n割线 AB、CD 交于 P, PA = 2, PB = 6, PC = 4', { dim: 2, facts: ['PD', '|AB|'], minFacts: 10 }],
  ['切割线定理', '⊙O: r = 5\n切线 PT、割线 PAB, PA = 2, PB = 6', { dim: 2, facts: ['PT'], minFacts: 8 }],
  ['圆与点（幂 · 弦 · 圆周角）', 'x^2 + y^2 = 25\nA(3, 4), B(0, 5), C(-4, 3), D(7, 0)', { dim: 2, facts: ['|AB|', '\\text{切线长}_{D}', '\\angle ACB'], inView: [[3, 4], [-4, 3]] }],
  // ---- parallel lines: transversal angles ----
  ['平行线的截线', 'y = 0\ny = 3\nx - y = 0', { dim: 2, facts: ['同位角', '内错角', '同旁内角', '截线段'] }],
  // ---- vector projections ----
  ['向量投影向量', '𝐚 = (2, 3); 𝐛 = (1, 0)', { dim: 2, kinds: ['vector', 'vector'], facts: ['\\text{proj}'] }],
  // ---- triangle: HL, median / height inputs, angles + area, projection theorem ----
  ['HL 斜边直角边', '△ABC: a = 3, c = 5, C = 90°', { dim: 2, facts: ['b=4'], minFacts: 10 }],
  ['中线还原三角形', '△ABC: b = 4, c = 3, m_a = 2.5', { dim: 2, facts: ['a=5', '\\angle A=90'], minFacts: 10 }],
  ['高与面积', '△ABC: a = 3, c = 5, h_c = 2.4', { dim: 2, facts: ['S=6'] }],
  ['两角 + 面积', '△ABC: A = 60°, B = 60°, S = 3sqrt(3)/4', { dim: 2, facts: ['\\sqrt{3}', 'R'], minFacts: 10 }],
  ['直角三角形射影定理', '△ABC: a = 3, b = 4, c = 5', { dim: 2, facts: ['\\text{斜边上的高}', '\\text{射影}_{a}'], minFacts: 14 }],
  // ---- midpoints / section points / derived vectors ----
  ['中点与中位线', 'A(0,0), B(4,0), C(1,3)\nM = 中点(A, B), N = 中点(A, C)', { dim: 2, facts: ['\\text{中位线}_{MN}', 'M=\\left(2'], inView: [[0, 0], [4, 0]] }],
  ['定比分点', 'A(0,0), B(6,0)\nP = 分点(A, B, 1:2)', { dim: 2, facts: ['|AP|=2', '|PB|=4'], inView: [[2, 0]] }],
  ['向量的和与投影', '𝐚 = (1, 2); 𝐛 = (3, 0)\n𝐜 = 𝐚 + 𝐛\n𝐩 = 投影(𝐚, 𝐛)', { dim: 2, facts: ['\\mathbf{c}', '\\parallel'], inView: [[4, 2], [1, 0]] }],
  // ---- parallel lines: intercept theorem + similar triangles ----
  ['平行线分线段成比例', 'y = 0\ny = 1\ny = 3\nx = 0\nx - y = 0', { dim: 2, facts: ['成比例', '相似比'] }],
  // ---- notation rules ----
  ['小写不能当向量定义', 'b = (1, 2)', { error: /粗体/ }],
  ['小写不能当点', 'b(1, 2)', { error: /大写字母/ }],
  ['大写点', 'B(1, 2)', { kinds: ['point'] }],
  // ---- 3D ----
  ['曲面 z = sin x cos y', 'z = sin(x)cos(y)', { dim: 3 }],
  ['碗面 z = x² + y²', 'z = x^2 + y^2', { dim: 3 }],
  ['两平面交线', 'x + y + z = 3\nx - y + 2z = 1', { dim: 3, facts: ['α \\cap β'] }],
  ['球面', 'x^2 + y^2 + z^2 = 4', { dim: 3, facts: ['r=2'] }],
  ['球面 ∩ 平面', 'x^2 + y^2 + z^2 = 4\nz = 1', { dim: 3, facts: ['\\rho_', '\\text{圆}'] }],
  ['异面直线四点', 'A(0,0,0)\nB(1,0,0)\nC(0,1,0)\nD(0,1,1)', { dim: 3, facts: ['d(AB, CD)=1', '异面'] }],
  ['空间螺旋线', 'r(t) = (cos(t), sin(t), t/3)', { dim: 3 }],
  ['空间三点', 'P(1,2,3), Q(0,1,-1), R(2,0,1)', { dim: 3 }],
]
for (const s of SAMPLES) cases.push([`示例 · ${s.title}`, s.blocks.join("\n"), {}])
