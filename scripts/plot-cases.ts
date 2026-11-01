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
  ['解三角形 SSS', '△ABC: a=3, b=4, c=5', { dim: 2, facts: ['90', 'S_{\\text{海伦}}', '|OI|', 'r_a=', 'AF_{c}', '\\Pi_{\\text{Ceva}}', '\\Pi_{\\text{Menelaus}}', '\\text{Stewart}_{m_', 'ID_{a}', '\\mathcal{A}_', 'OG:GH', 'R_{\\text{九点}}', '|NI|', '|NI_a|', 'Sp', 'Na', 'IG:GNa', 'Ge=', 'K=', '\\omega', '\\Omega', 'L=', 'Mi', 'Sc', 'Be=', 'H_a', 'X_a', 'r_{\\text{Sp}}', 'T_a', 'S_{\\text{Steiner}}', 'M_a', 'Ex=', 'S_{1}', 'St=', 'Ty=', 'N_1', 'Py', 'V_{\\text{out}}', 'X_{39}', 'Hf_0', 'Km', 'Ap', 'F_1', 'Fe', 'Ed', 'Ip', 'Mo', 'S_{+}', 'S_{-}', 'X_{30}', 'X_{57}', 'X_{58}', 'X_{84}', 'X_{12}=', 'X_{59}=', 'X_{60}=', 'Gr=', 'X_{81}=', 'X_{42}=', 'X_{65}=', 'X_{76}=', 'X_{86}=', 'X_{31}=', 'X_{32}=', 'X_{69}=', 'X_{36}', 'X_{41}', 'X_{48}', 'X_{20}=', 'X_{23}=', 'X_{35}=', 'X_{38}=', 'X_{61}=', 'X_{62}=', 'X_{63}=', 'X_{43}=', 'X_{44}=', 'X_{45}=', 'X_{46}=', 'X_{47}=', 'X_{49}=', 'X_{50}='], minFacts: 157 }],
  ['欧拉反射点（锐角）', '△ABC: a=6, b=7, c=8', { dim: 2, facts: ['E_r', 'E_r \\in (O)', 'Ko', 'Cl', 'Yff', 'X_{25}', 'O(H_a', 'X_{24}', 'X_{64}'], minFacts: 10 }],
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
  ['异面直线四点', 'A(0,0,0)\nB(1,0,0)\nC(0,1,0)\nD(0,1,1)', { dim: 3, facts: ['d(AB, CD)=1', '异面', '\\theta(AB, CD)'] }],
  ['线面角', 'A(0,0,0)\nB(0,0,1)\nC(1,0,0)\nz = 0', { dim: 3, facts: ['\\theta(AB, α)', 'AB \\perp α', 'AC \\parallel α', '\\text{foot}(B, α)'] }],
  ['两圆根轴', 'x^2 + y^2 = 4\n(x-3)^2 + y^2 = 4', { dim: 2, facts: ['l_{', '相交', '公共弦'] }],
  ['两球根面', 'x^2 + y^2 + z^2 = 4\n(x-3)^2 + y^2 + z^2 = 4', { dim: 3, facts: ['\\pi_', '\\rho_', '公共弦'] }],
  ['四面体体积', 'A(0,0,0)\nB(1,0,0)\nC(0,1,0)\nD(0,0,1)', { dim: 3, facts: ['V_{\\text{四面体}}', 'V_{\\text{Cayley', 'S_{\\triangle', 'h_{'] }],
  ['二面角', 'x + 0*z = 0\ny + 0*z = 0', { dim: 3, facts: ['\\text{二面角}', '\\perp'] }],
  ['直线交球面', 'A(0,0,0)\nB(4,0,0)\nx^2 + y^2 + z^2 = 4', { dim: 3, facts: ['P_{AB\\cap', '|P_1P_2|'] }],
  ['笛卡尔圆', 'A(0,0)\nB(2,0)\nC(1,1.7320508075688772)\n⊙A: r = 1\n⊙B: r = 1\n⊙C: r = 1', { dim: 2, facts: ['\\text{Descartes}'], minFacts: 2 }],
  ['圆柱截椭圆', 'x^2 + y^2 = 4\nx - z = 0', { dim: 3, facts: ['a_', 'b_', 'e_', '\\text{椭圆}'] }],
  ['英国国旗定理', 'A(0,0), B(4,0), C(4,3), D(0,3)', { dim: 2, facts: ['矩形', 'PA^2 + PC^2'], minFacts: 4 }],
  ['瓦里农平行四边形', 'A(0,0), B(4,0), C(5,3), D(1,3)', { dim: 2, facts: ['\\text{Varignon}', 'M_0'] }],
  ['三圆根心', 'A(0,0)\nB(2,0)\nC(1,1.7320508075688772)\n⊙A: r = 1\n⊙B: r = 1\n⊙C: r = 1', { dim: 2, facts: ['l_{', 'R_{\\odot', '\\text{幂}'], minFacts: 5 }],
  ['维维安尼等边', '△ABC: a = 2, b = 2, c = 2', { dim: 2, facts: ['d_a + d_b + d_c'], minFacts: 4 }],
  ['平行四边形法则', '𝐚 = (3, 4); 𝐛 = (1, 0)', { dim: 2, kinds: ['vector', 'vector'], facts: ['|a+b|^2 + |a-b|^2'] }],
  ['托勒密与婆罗摩笈多', 'A(0,0), B(4,0), C(4,3), D(0,3)', { dim: 2, facts: ['\\text{共圆}', 'AC \\cdot BD', 'S_{\\text{Brahmagupta}}'], minFacts: 4 }],
  ['拿破仑定理', '△ABC: a = 3, b = 4, c = 5', { dim: 2, facts: ['\\text{Napoleon}', '|G_aG_b|'], minFacts: 3 }],
  ['欧拉OH²与卡诺', '△ABC: a = 3, b = 4, c = 5', { dim: 2, facts: ['|OH|^2', '9R^2', 'R+r', 'H \\leftrightarrow O'], minFacts: 6 }],
  ['莫利定理', '△ABC: a = 3, b = 4, c = 5', { dim: 2, facts: ['\\text{Morley}', '|M_0M_1|'], minFacts: 3 }],
  ['西姆松与三线极线', '△ABC: a = 3, b = 4, c = 5', { dim: 2, facts: ['\\text{Simson}', 'l_{\\text{Simson}}', '\\tau(I)', 'OH\\text{ 九点圆直径}'], minFacts: 6 }],
  ['凯莱门杰四面体', 'A(0,0,0)\nB(1,0,0)\nC(0,1,0)\nD(0,0,1)', { dim: 3, facts: ['V_{\\text{四面体}}', 'V_{\\text{Cayley'] }],
  ['米克尔完全四线形', 'y = 0\nx = 0\nx + y = 2\nx - y = 1', { dim: 2, facts: ['\\text{Miquel}', 'M'], minFacts: 2 }],
  ['德萨格透视', 'A(2,1), B(-1,2), C(-2,-3), A\'(4,2), B\'(-3,6), C\'(-1,-1.5)', { dim: 2, facts: ['\\text{Desargues}', '\\text{透视轴}'], minFacts: 2 }],
  ['圆柱截线离心率', 'x^2 + y^2 = 4\nx - z = 0', { dim: 3, facts: ['a_', 'b_', 'e_', '\\text{椭圆}'] }],
  ['圆锥截线离心率', 'x^2 + y^2 - z^2 = 0\nx + 2z = 2', { dim: 3, facts: ['e_', '\\text{椭圆}'] }],
  ['帕斯卡圆内接六边形', 'A(5,0), B(4,3), C(-3,4), D(-5,0), E(-3,-4), F(4,-3)', { dim: 2, facts: ['\\text{Pascal}', '\\text{Pascal线}'], minFacts: 2 }],
  ['布利安雄正六边形', 'A(1,0), B(0.5,0.8660254037844386), C(-0.5,0.8660254037844386), D(-1,0), E(-0.5,-0.8660254037844386), F(0.5,-0.8660254037844386)', { dim: 2, facts: ['\\text{Brianchon}', 'a+c+e'], minFacts: 2 }],
  ['四面体面与高', 'A(0,0,0)\nB(1,0,0)\nC(0,1,0)\nD(0,0,1)', { dim: 3, facts: ['S_{\\triangle', 'h_{'], minFacts: 8 }],
  ['点关于直线反射', 'P(1,2)\ny = 0', { dim: 2, facts: ['P^{\\prime}', 'd(P'], minFacts: 2 }],
  ['点关于平面反射', 'Q(1,2,3)\nz = 0', { dim: 3, facts: ['Q^{\\prime}', '\\text{foot}'], minFacts: 2 }],
  ['空间螺旋线', 'r(t) = (cos(t), sin(t), t/3)', { dim: 3 }],
  ['空间三点', 'P(1,2,3), Q(0,1,-1), R(2,0,1)', { dim: 3 }],
]
for (const s of SAMPLES) cases.push([`示例 · ${s.title}`, s.blocks.join("\n"), {}])
