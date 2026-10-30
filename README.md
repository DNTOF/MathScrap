# 数手账 · MathScrap（演示版）

A math-learning scrapbook in kraft paper (in the spirit of Apple Freeform / Notes). Paste formula cards on a page, write freely, then click the **small plot button** in the bottom-right corner of a card. It opens an interactive 2D/3D coordinate system and **derives as many quantities as possible** from the known conditions: remaining sides and angles, intersections, unknown parameters, area, domain, and more.

> 本仓库是一个可点击的演示：Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui，绘图用 Plotly，数学核心是 **Rust 编译的 WebAssembly**（`crates/mathcore`）。

---

## 快速开始

```bash
npm install
npm run dev        # http://localhost:47321
```

- 不需要安装 Rust：编译好的 WASM（`src/wasm/pkg/`）已经提交在仓库里。
- 改了 Rust 代码才需要重新编译（见下文 “Rust / WASM”）。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（端口 47321，监听 0.0.0.0，手机/平板可用局域网 IP 访问） |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm run preview` | 预览生产构建（端口 47322） |
| `npm run lint` | oxlint |
| `npm run smoke` | 用 Node 直接加载 WASM，把全部示例公式跑一遍推导，打印结果 |
| `npm run build:wasm` | 重新编译 Rust → WASM（需要 Rust + wasm-pack） |
| `npm run test:rust` | Rust 单元测试 |

---

## 开箱即用的示例公式

首次打开时，页面上已经贴好了 8 张示例卡片；右上角 **示例** 里还有更多。也可以复制下面任意一条到底部输入框，按 Enter 贴到页面，再点卡片右下角的图表按钮。

**1. 抛物线与直线（2D）**

```
y = x^2 - 2
y = 0.5x + 1
```

→ 两个交点 \((-1.5, 0.25)\)、\((2, 2)\)，各自的零点、极值、定义域，以及直线的斜率、截距、倾斜角。

**2. 解三角形：只给两边一角（SAS）**

```
△ABC: a = 5, b = 7, C = 60°
```

→ \(c = \sqrt{39}\)、∠A、∠B、面积 \(\frac{35\sqrt3}{4}\)、周长、外接圆 / 内切圆半径、三条高、中线、重心 / 外心 / 内心……每一项都标出“用了什么定理”，可以一键标在图上。

**3. 坐标几何 + 垂直条件（带未知数）**

```
A(0,0), B(4,0), C(1,t)
AC ⊥ BC
```

→ Rust 解出 \(t = \pm\sqrt3\)（可切换两组解），然后把整个三角形推出来：直角、边长、面积、各心坐标。

更多示例，全部可以直接使用：

| 写法 | 推出什么 |
| --- | --- |
| `x + y + z = 3` 换行 `x - y + 2z = 1` | 3D：法向量、两平面夹角、交线参数式 |
| `z = sin(x)cos(y)` | 3D 曲面，可自由旋转，网格上的最大值、最小值 |
| `f(x) = ax^2 + bx + c` 换行 `f(0) = 1; f(1) = 0; f(3) = 4` | 待定系数：a = 1, b = −2, c = 1 |
| `a = (1, 2, 2); b = (2, 1, k)` 换行 `a ⊥ b` | k = −2，然后算点积、叉积、夹角、投影 |
| `x^2 + y^2 - 4x + 2y = 4` 换行 `y = x - 1` | 识别为圆：圆心 (2, −1)、半径 3，以及与直线的交点 |
| `A(0,0), B(4,0), C(5,3), D(1,3)` | 判定为平行四边形，算出面积、对角线 |
| `y = kx + b, 过(1, 3), 过(2, 5)` | k = 2, b = 1 |
| `x^2 + y^2 + z^2 = 4` | 球面：球心、半径、体积、表面积 |
| `r(t) = (cos(t), sin(t), t/3)` | 3D 参数曲线（螺旋线） |

### 输入写法速查

- 隐式乘法：`2x`、`kx`、`sin(x)cos(y)`，以及 `x^2`、`sqrt(x)`、`|x|`、`pi`、`e`、`a_1`；也能直接输入 `π`、`θ`、`²`、`√`。
- 角度：`30°`、`30deg`，或者直接写 `C = 60`（在三角形里按角度理解）。
- 点和向量：`A(1,2)`、`P(1,2,3)`、`a = (1,2,2)`、`AB = (3,4)`。
- 关系：`⊥` 或 `_|_`，`∥` 或 `//`，`|AB| = 5`，`∠ABC = 90°`，`过(1, 3)`。
- 三角形：`△ABC: a=3, b=4, c=5`，也可以写 `triangle ABC: ...` 或 `三角形ABC: ...`。可用的量有 a、b、c、A、B、C 和面积 S。
- 一张卡片里可以写多个条件，用换行、`;` 或顶层逗号分隔。

---

## 三种写字方式（PC 端也不只是键盘）

1. **手写**：鼠标、触控、手写笔都能直接在牛皮纸上写。写完点左侧的「手写转公式」（快捷键 `R`），会弹出识别候选（目前是演示桩，见下文），确认或修改后就贴成公式卡片；原来的笔迹可以选择保留。
2. **键盘 + 纸上快捷键提示**：按 `/` 或点底部输入框，快捷键表会以铅笔字的样子淡淡浮现在纸上。

   | 快捷键 | 插入 | 快捷键 | 插入 |
   | --- | --- | --- | --- |
   | `Ctrl/⌘ + /` | 分数 `(□)/(□)` | `Alt/⌥ + 2` | `^2` |
   | `Alt + 6` | `^(□)` | `Alt + R` | `sqrt(□)` |
   | `Alt + A` | `\|□\|` | `Alt + P` / `T` | `pi` / `theta` |
   | `Alt + O` | `°` | `Alt + S` / `C` / `L` / `E` | sin / cos / ln / e^ |
   | `Alt + V` / `W` | 3D / 2D 向量 | `Alt + H` | `, 过(□, □)` |
   | `Alt + D` | `△ABC: …` 模板 | `Alt + K` / `J` / `G` | ⊥ / ∥ / ∠ |
   | `Tab` | 跳到下一个 □ | `Shift + Enter` | 换行写下一个条件 |

3. **浮动数学键盘**：在桌面端，输入框获得焦点时右侧会出现；在手机上它是输入框上方的一排大按键。点按键不会让输入框失去焦点。

画布上的快捷键：`P` 笔、`M` 马克笔、`E` 橡皮、`H` 抓手、`R` 手写转公式、`Ctrl+Z` 撤销、`Ctrl+Shift+Z` / `Ctrl+Y` 重做、`Delete` 删除选中卡片、`Enter` 打开选中卡片的坐标系。按住空格或鼠标中键拖动可以平移，`Ctrl + 滚轮` 或双指捏合可以缩放。

**笔的样式**：墨水（带压感，基于 perfect-freehand）、虚线、点线、铅笔（带纸纹颗粒）、和纸胶带、荧光马克笔。可以调粗细和颜色。

### 多设备

- **手机**：底部是大按钮工具栏，加一个「公式」按钮；顶部操作收进「更多」菜单；坐标系面板全屏，图在上、推导结果在下。
- **平板 / 桌面**：左侧竖排工具栏，坐标系面板左边是图、右边是推导结果。
- **输入方式**：Pointer Events 统一处理鼠标、触控和手写笔。检测到手写笔之后会自动开启防误触（手掌触碰不画线，单指触碰改为平移）；设置里也可以强制开启「仅手写笔书写」。
- **手写笔 / 数位板**：这类应用最理想的输入设备是 Apple Pencil、Surface Pen 或 Wacom 数位板。压感已经接入笔画粗细。后续计划利用倾斜角和悬停预览，并接入真正的手写公式识别。

---

## 推导引擎（核心功能）

“给几个已知量，尽量多推出别的量”这件事，完全在 Rust/WASM 里完成：

- **解三角形**：覆盖 SSS、SAS、SSA（含两解 / 无解的判断）、AAS/ASA，以及给面积的情况。推出边、角、面积、周长、R、r、三条高、中线、角平分线，以及三角形的类型（锐角 / 直角 / 钝角，等腰 / 等边）。每一条结果都附上所用的定理。
- **坐标点**：两点之间的距离、中点、斜率。三点组成的三角形会给出各心和面积。四点会判定平行四边形、矩形、菱形、正方形、梯形。3D 中三点确定一个平面，四点组成四面体并计算体积。
- **未知参数**：多起点 Levenberg–Marquardt 求解非线性方程组，条件可以是 ⊥、∥、|AB|=、∠=、过点、`f(a)=b`、`f'(a)=b`，也可以是任意方程。多组解时可以在面板里切换。
- **直线与圆锥曲线**：直线的斜率、截距、倾斜角、两直线的交点与夹角、点到直线的距离。二次曲线由特征值分类为圆、椭圆、双曲线或抛物线，并给出中心、半轴、焦点、离心率、渐近线、准线。
- **函数**：定义域（扫描断点和渐近线）、零点（变号二分 + 切点检测）、极值（黄金分割 + 渐近线剔除）、两两之间的交点。
- **向量与平面**：点积、叉积、夹角、投影、混合积。平面的法向量、两平面夹角、交线、三平面交点、点到平面的距离。
- **精确形式**：数值结果会被尽量还原成 √、分数、π 的形式，例如 \(\sqrt{39}\)、\(\frac{35\sqrt3}{4}\)、\(\frac{\pi}{3}\)。

坐标系面板右侧依次列出三部分：「已知 N 条 → 推出 M 项」、每一项的推导依据，以及一个可以在图上标出该项的眼睛开关。页面上同一维度的其他卡片可以一键叠加，叠加后会自动求它们之间的交点。

---

## Rust / WASM：JS ↔ Rust 边界

```
crates/mathcore/            Rust crate（cdylib + rlib）
  src/expr.rs               表达式分词、解析（隐式乘法、字母拆分）、编译成槽位求值、LaTeX
  src/numeric.rs            采样、求根、极值、断点、线性/非线性方程组、系数识别
  src/geometry.rs           三角形 / 点 / 向量 / 直线 / 平面 / 圆锥曲线推导，统一输出 Fact
  src/lib.rs                #[wasm_bindgen] 导出
src/wasm/pkg/               wasm-pack 产物（已提交，约 430 KB）
src/wasm/engine.ts          唯一的 JS 入口：加载、类型化、计时统计
src/math/statements.ts      TS：把卡片文本解析成语句（点、曲线、约束、三角形…）
src/math/scene.ts           TS：编排——决定调用哪些 Rust 函数、组织推导结果
```

**边界约定**：

- 跨边界只传字符串和数字。表达式用 ASCII 源码（如 `"x^2 - 2"`）。变量环境用 JSON 对象字符串（如 `{"k": 2}`）。
- 结构化结果以 JSON 字符串返回。
- 数值采样直接返回 `Float64Array`，不经过 JSON。
- TS 只经由 `src/wasm/engine.ts` 调用，每次调用都会计时，设置面板和推导面板底部会显示调用次数与耗时。

| 导出 | 输入 | 输出 |
| --- | --- | --- |
| `latex(src)` / `inspect(src)` | 表达式 | LaTeX / `{ok, error, vars, source}` |
| `eval(src, env)` | 表达式、环境 | `f64` |
| `sample_curve(src, var, env, a, b, n)` | | `Float64Array`（n 个 y 值，无定义为 NaN） |
| `sample_grid(src, x, y, env, x0, x1, y0, y1, nx, ny)` | | `Float64Array`，行优先 |
| `sample_volume(src, env, lo, hi, n)` | | `Float64Array`，索引为 `(k*n+j)*n+i` |
| `roots` / `domain_gaps` / `intersect_curves` / `intersect_curve_implicit` | 表达式与区间 | `Float64Array` |
| `extrema(src, var, env, a, b)` | | JSON `[{x, y, kind}]` |
| `solve_system(eqs_json, unknowns_json, env)` | 残差表达式数组、未知数名 | JSON `{unknowns, solutions, exact, starts, error}` |
| `linear_coeffs` / `conic_analyze` | 方程 | 系数 / 圆锥曲线推导 |
| `triangle_solve(known_json)` | `{a,b,c,A,B,C,S}`（角用弧度，缺省即未知） | JSON `{cases: [{facts, vertices, note}], error}` |
| `points_analyze` / `vectors_analyze` / `lines_analyze` / `planes_analyze` | JSON | JSON `Fact[]` |
| `nice_number(v)` | `f64` | 精确形式的 LaTeX |

所有推导结果都是统一的 `Fact`：

```ts
{ group, label, value, num, how, why, shape }
```

其中 `shape` 是可选的几何形状（点、圆、线段、3D 直线、3D 箭头），图上的高亮就靠它渲染。

**重新编译 WASM**：

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
npm run build:wasm   # 输出到 src/wasm/pkg 并删除 wasm-pack 生成的 .gitignore
npm run test:rust
npm run smoke
```

---

## AI API 与 MCP（预留）

这一版**不调用任何模型**。预留的部分如下：

- **设置 → AI API**：可以填 provider、Base URL、模型和 Key。这些只保存在浏览器的 localStorage（`mathscrap.ai.v1`）里，不会发出去；「测试连接」目前只是提示。
- **工具层（MCP 形状）**：`src/ai/tools.ts` 按 MCP tool 的格式定义了 `name`、`description` 和 `inputSchema`，处理函数已经在浏览器里接好。可以在控制台试：

```js
mathscrap.tools.specs
mathscrap.tools.call('page_read')
mathscrap.tools.call('solve_analyze', { texts: ['△ABC: a=3, b=4, C=90°'] })
mathscrap.tools.call('page_add_formula', { text: 'y = x^2 - 2' })
```

| 工具 | 状态 | 说明 |
| --- | --- | --- |
| `page_read` | 本地可用 | 读取当前页：卡片原文、位置，以及笔迹数量 |
| `page_add_formula` / `page_update_formula` | 本地可用 | 新增或修改公式卡片 |
| `solve_analyze` | 本地可用 | 对一组条件做推导，返回结构化结果（由 Rust 计算） |
| `plot_open` | 本地可用 | 打开某张卡片的坐标系 |
| `plot_set_view` | 规划中 | 修改坐标范围、3D 相机、叠加对象，让 AI 能直接操作坐标系 |
| `ink_read` | 规划中 | 把笔迹点序列交给识别模型或多模态 LLM |

**后续计划**：

1. 写一个很薄的 MCP server（stdio 或 WebSocket），把上面这些工具桥接到页面，让外部 agent 能读懂页面、改公式、调整坐标系。
2. 推导仍然交给 Rust，LLM 只负责“读题 → 写成本应用的语法”和“用自然语言解释推导步骤”。

---

## 手写识别（演示桩）

`src/ocr/recognizer.ts` 定义了识别接口：

```ts
interface Recognizer {
  id: string
  name: string
  recognize(strokes: Stroke[]): Promise<{ text: string; confidence: number }[]>
}
```

当前的 `mockRecognizer` 只根据笔迹的外形统计量（宽高比、笔画数）猜几个候选，所以识别结果总是要用户确认或修改。以后接入真正的识别（端侧模型、MyScript、Mathpix 或多模态 LLM）时，只需要实现这个接口。

---

## 项目结构

```
src/
  App.tsx                 状态编排、全局快捷键、工具桥
  board/                  画布（平移、缩放、捏合、笔迹、橡皮）、卡片、撤销历史、示例页
  input/                  输入框、快捷键片段、纸上提示、数学键盘
  plot/                   坐标系面板、Plotly 图形构建、推导结果列表
  math/                   语句解析与场景推导（调用 WASM）
  wasm/                   WASM 产物与类型化封装
  ocr/                    识别接口与演示桩
  ai/                     MCP 形状的工具定义
  components/             顶栏、工具栏、设置、KaTeX；ui/ 是 shadcn 组件
crates/mathcore/          Rust 数学核心
scripts/smoke.ts          Node 端到端冒烟测试
```

页面内容自动保存在 localStorage（`mathscrap.doc.v1`）里。「清空」只清当前页，清空后可以撤销。
