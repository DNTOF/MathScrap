# MathScrap 墨迹手感原型（预测 + 平滑 + 扫掠胶囊橡皮 + 按指针类型容差）

日期：2026-11-12 / 2026-11-13（第二、三、四轮）· 分支：`experiment/ink-prediction-20261112`（基于本地 main `67b785a`）· worktree：`MathScrap-ink-proto`

目的：参考对希沃白板 5.2.4 的只读逆向**结论**（只学思路，不复制其代码/常量表/资源），在 MathScrap 里做默认关闭的墨迹手感原型：去近点 + 中点二次贝塞尔平滑、短时程预测显示、扫掠胶囊橡皮、按指针类型容差、湿墨增量重绘。不引入任何新依赖（未 vendor ink-stroke-modeler，仅参考其公开论文/思路）。

## 现状（main 分支）

- 采集：`src/board/Board.tsx` `onPointerMove`（draw 分支）——已用 `getCoalescedEvents()`，逐事件转世界坐标后丢弃与笔尖距离 <0.8 屏幕 px 的近点，`pts` 平铺为 `[x, y, pressure, ...]`（世界坐标，无真实压感时恒 0.5，`types.ts`）。
- 渲染：`src/board/strokes.tsx` `StrokeShape`——`ink` 样式走 perfect-freehand 轮廓（streamline 0.45），其它样式走 `centerPath`（**已经是**中点二次贝塞尔 Q 曲线）。湿墨（live）与干墨同一条渲染路径。
- 橡皮：`Board.tsx` `eraseAt`——每个 move 事件单点 `hitStroke`（半径固定 `12/scale` 世界单位），**没有**事件间的扫掠，快速移动会漏擦。
- 容差：不区分指针类型（鼠标/触摸/笔同一阈值）。
- 测试：仓库没有单测框架；`tsx` + Node 内置 `node:test` 可用（Node 24）。

## 方案（全部默认关闭）

新增 `src/ink/` 纯函数模块 + `Board.tsx`/`App.tsx` 最小集成。开关存在 `localStorage['mathscrap.ink-flags.v1']`（JSON），URL 参数优先，并可由调试面板实时切换（响应式 store + `useSyncExternalStore`）。

| 开关 | URL 参数 | 功能 |
|---|---|---|
| `smoothing` | `ink-smooth=1` | 采集去近点阈值 0.8→0.5 DIP（`appendStrokePoint`）；抬笔时把中点二次贝塞尔采样折线烘焙进保存的 `pts`（端点精确不变，点数 <3 不处理）；湿墨实时按同一函数渲染，湿/干一致 |
| `prediction` | `ink-predict=1` | 湿墨尾部显示外推点：优先 `getPredictedEvents()`（Chromium），不可用则自研兜底——每轴 2 状态常速卡尔曼。**步长/时程按 rAF 估计的刷新率自适应**（60Hz≈33ms/8.3ms 步长、120Hz≈16.7ms/4.2ms 步长，见 `frameAdaptivePrediction`），直线满时程 ≈2 帧、曲线减半、绝对上限 36ms；门控 `gateSamples`：速度 <0.04px/ms（idle）、单次转角 >65°（sharp）、两次反向大转角或 ≥3 次摆动（jitter）时关闭。**预测点绝不写入保存数据**，下一帧真实点即替换；采样历史窗口上限 96 |
| `predictionGhost` | `ink-ghost=1` | 预测子选项：预测尾从实墨路径拆出，用独立半透明路径（opacity 0.4，`predictionTailPath` 从笔画末端起笔）渲染，避免把预测误读为实际墨迹；关闭时维持第二轮融资的合并渲染 |
| `capsuleEraser` | `ink-capsule=1` | `hitSweep`：上一位置到当前位置的扫掠胶囊（线段-线段距离 + `hitStroke` 同款宽度余量：ink/pencil ×0.8，marker/washi ×2.5）；按住起点仍是原单点测试 |
| `pointerTolerance` | `ink-tolerance=1` | 橡皮半径按指针类型取命中容差（鼠标/触摸/笔 = 3/10/5 DIP ÷ 缩放）；**点按折叠看双条件**——整笔位移 < 该类型拖动阈值（1/16/4 DIP ÷ 缩放）**且**按下时长 ≤250ms（`TAP_MAX_DURATION_MS`）才折叠成落笔点圆点，慢速刻意短笔画保留为笔画。`hasRealPressure`：恒 0.5/0 视为无压感设备 |
| `wetIncremental` | `ink-wet-inc=1` | 平滑子选项：湿墨增量重绘。中点贝塞尔每段只依赖 P[i-1..i+1]，段一旦生成即不再变化——`updateIncrementalSmooth` 每个事件只补算新确定的 1 段 + 端点（复用共享的 `pushSegmentSamples`），与抬笔时的整笔烘焙**逐位一致**（单测保证），2000 点笔画每帧平滑成本 182.7µs → 0.5µs |

调试面板 `src/ink/InkDebugPanel.tsx`：`?ink-debug=1` 强制显示（`=0` 隐藏），否则仅**开发构建且任一实验开关打开**时显示（生产无参数不可见）。面板可实时切换六个开关，显示 pointerType、是否有真实压力、`getPredictedEvents` 可用性、最近预测点数及来源（native/self/off）、move 处理耗时、rAF 帧间隔与刷新率估计（Hz）、当前笔画点数。

集成点：`Board.tsx`（响应式 flags、`pointerTypeRef`、`eraseRadius()`、`finishStroke` 点按折叠（位移+时长）、`updatePrediction` 自适应步长 + 统计、draw 分支增量湿墨 + 计时、渲染处 `liveDisplay`/`tailDisplay` 分离）与 `App.tsx`（仅挂载面板一处）。`strokes.tsx`、OCR（`src/ocr/**`）、签名、版本号均未改动。

开关全关时：draw 循环经 `appendStrokePoint(…, 0.8, …)`（单测证明与 main 内联循环逐事件等价），橡皮半径 12/scale、无折叠/预测/平滑/增量，行为与 main 完全一致。

## 风险

- 平滑与点按折叠会改变保存的 `pts` 几何（切角/折叠），开启后影响 OCR/几何推理输入形状（本 worktree 未动 OCR 代码，但输入墨迹会变）。默认关闭。
- 点按折叠现含时长条件（≤250ms），大幅降低"吃掉刻意短笔画"的风险，但快速描点式书写（连续快短笔）仍可能被折叠——原型取舍，已记录。
- 卡尔曼/门控/自适应常数为按手写速度量级手调，**未在真机验证手感**；rAF 估计在后台标签页会暂时失真（已 clamp 4-33ms）。
- `getPredictedEvents` 仅 Chromium 提供；Firefox/Safari 走自研兜底，兜底在浏览器中未实测。
- ghost 预测尾对 marker/washi 等宽笔会渲染成半透明宽带，视觉是否合适待实机确认。
- 增量湿墨与整笔烘焙的一致性由单测逐位保证，但 React 渲染时序（state 批处理）下的实际表现待实机确认。

## 改动文件（本 worktree，未提交）

- `src/ink/flags.ts`：六开关解析/加载 + 响应式 store + 面板门控
- `src/ink/smooth.ts`：去近点、`pushSegmentSamples`（整笔/增量共享采样）、`midpointBezierPolyline`、`createIncrementalSmooth`/`updateIncrementalSmooth`（增量缓存）
- `src/ink/predict.ts`：门控 + 卡尔曼 + native 预测 + 历史窗口上限 + `frameAdaptivePrediction`（刷新率自适应，可选 framesAhead/curveFraction）+ `predictionTailPath`（ghost 独立路径）+ `PredictOptions.qAcc/measVar`（回放调参旋钮，默认不变）+ 门控噪声鲁棒性修复（翻转只看最近 12 对、曲线判定用中位数转角）
- `src/ink/replay.ts`（合成轨迹生成 + 回放指标，纯 Node）、`src/ink/replay.test.ts`（回放单测）
- `experiments/2026-11-12-ink-prediction/replay.ts`（回放 runner）、`replay-output.txt`（第四轮结果存档）
- `src/ink/capsule.ts`（扫掠胶囊）、`src/ink/tolerance.ts`（指针类型容差/无压感判定/位移+时长点按判定）、`src/ink/debug.ts`（面板数据暂存）、`src/ink/InkDebugPanel.tsx`（调试面板，六开关 + 刷新率行）
- 测试 `src/ink/{smooth,predict,capsule,flags,integration,tolerance}.test.ts`（顶部 `/// <reference types="node" />`，因 tsconfig.app.json `types:["vite/client"]` 不含 node 类型；未改 tsconfig）
- `src/board/Board.tsx`：集成六个开关 + 统计上报（唯一被改的既有组件）
- `src/App.tsx`：挂载调试面板（一处）
- `experiments/2026-11-12-ink-prediction/bench.ts`（微基准）、本 README

未改动：`strokes.tsx`、`src/ocr/**`、`src/wasm/**`、`package.json`、版本号、签名、默认引擎。

## 测试

命令（在 `MathScrap-ink-proto` 下，轻量、无构建/打包/推理）：

```
npx tsx --test src/ink/*.test.ts   # 55 tests, 55 pass / 0 fail
npx tsc -p tsconfig.app.json       # 类型检查通过（0 错误）
npx oxlint src/ink src/board src/App.tsx   # src/ink 0 警告；board=6、App=3 与 main 基线完全相同
```

覆盖要点：平滑端点不变/无 NaN/压感在邻域内、flag-off 与 main 采集循环等价；门控（直线/曲线/急转/抖动/停笔/样本不足）、预测尾时程 ≤36ms 与输入不可变；**预测点永不进入保存笔画**；胶囊快速移动命中、退化成圆、宽度余量；指针类型映射与三档阈值 ÷ 缩放、无压感判定；**点按 = 位移且时长双条件**（慢速刻意短笔画保留）；**刷新率自适应**（60/120/144Hz 步长与时程单调、绝对上限、退化 clamp）；**增量平滑在每个前缀上与整笔重采样逐位一致**、冷启动、no-op、输入不变性；ghost 路径从笔画末端起笔且不改输入；开关默认全关、解析优先级、store 稳定性、面板门控。

## 性能微基准（Node 24 / tsx，单线程，与 OCR 任务并存时测得）

`npx tsx experiments/2026-11-12-ink-prediction/bench.ts`：

| 项目 | 单次耗时 |
|---|---|
| 平滑 200 点（整笔重采样，每湿墨帧） | 13.1 µs |
| 平滑 2000 点（整笔，压力测试） | 328.5 µs |
| **增量平滑每事件（2000 点笔画全程）** | **0.5 µs/事件（全程 0.91ms，比整笔快 ~399×）** |
| 整笔重采样每事件（2000 点全程均值） | 182.7 µs/事件（全程 364.98ms） |
| 门控 20 / 96 样本窗口 | 1.6 / 7.8 µs |
| 预测 20 / 96 样本 → 33ms | 1.8 / 6.6 µs |
| 胶囊命中 miss 200 / 2000 点 | 3.7 / 33.8 µs |
| 采集追加到 2000 点笔画 | 10.7 µs |
| 橡皮一帧：扫掠 20×200 点全 miss | 77.3 µs |

**结论：满足每帧 <1ms。** 真实帧（200 点湿墨平滑 + 96 样本门控/预测 + 20×200 点橡皮扫掠）≈ **0.105ms**；开 `wetIncremental` 后 ≈ **0.092ms**；压力帧（2000 点整笔重采样）≈ **0.420ms**，增量模式下平滑项 329µs → 0.5µs。湿/干形状一致性由单测保证（非基准断言）。

## 第四轮：离线回放评估（合成轨迹，2026-11-13）

**⚠ 全部为合成轨迹**（确定性 mulberry32 种子 + 高斯噪声 0.6px，只加在采样上、真值精确），不代表真实笔迹；下表常数只作为 **iPad 实测的初值候选**，本轮未改任何默认常数。工具：

```
npx tsx experiments/2026-11-12-ink-prediction/replay.ts   # 完整表格，输出已存档 replay-output.txt
```

- 轨迹（`src/ink/replay.ts`）：直线 600px/s、快弧（r=25 v=600，写 e/圈的极端情形）、急转（直行 600ms 后 90°）、抖动（±60° 交替锯齿）、停笔（300ms 保持上报）、慢短笔（6px/500ms），各 60Hz 与 120Hz 两档。
- 指标：在每次有足够历史的采样点上走与 Board 相同的门控+卡尔曼管线，预测尾**末端**与其自身时间戳上的精确真值比较 → errMean/errP95/errMax；过冲 = 误差在行进方向上的分量（+超前/−滞后）；pred% = 门控放行占比。
- 候选：A=现行默认（65/30/12，q=9e6，r=2，2 帧）；B=更响应（55/25/10，q=2e6，r=1，1.5 帧）；C=更激进（75/35/15，q=2.5e7，r=4，2.5 帧）；D=更保守（55/25/14，q=4e6，r=2，1.5 帧）。

各场景等权平均 errMean（完整逐场景表见 `replay-output.txt`）：

| 候选 | 60Hz | 120Hz |
|---|---|---|
| **A-现行默认** | 3.41px | 2.09px |
| **B-更响应** | **2.70px** | **1.76px** |
| C-更激进 | 3.45px | 3.05px |
| D-更保守 | 2.86px | 2.04px |

典型场景（errMean）：快弧 60Hz A=11.3px vs C=10.2px（KF 速度在急弯上滞后是主项，过冲 −2～−6px 即"滞后于切线"）；急转 60Hz A errMax=28px vs B/D=21px；停笔 60Hz A errMax=20px（停笔瞬间尾甩出，1.5 帧候选减半）；慢短笔全程 0% pred（idle 门控符合设计：不给刻意慢笔画外推）。

**回放发现并修复的两个门控真问题**（属于 prediction 实验内部的噪声鲁棒性修复，常数默认值未动）：
1. 抖动翻转规则原本在**整个窗口**累计 ≥3 次 ≥10° 的变号转角——真实尺度的指针噪声让直线全程被判 jitter、预测完全失效；改为只看**最近 12 对**转角、需两侧 ≥ jitterTurnDeg/2 且 ≥3 次翻转。
2. 曲线/直线判定原用窗口内**最大**转角——96 样本窗口的噪声几乎必然把最大值顶过阈值，直线永远读成"曲线"；改用**中位数**转角（急转判定仍用最大值，单个大转角仍立即关断）。

**结论**：B-更响应（更严门控 + 更低 q + 1.5 帧）在两类刷新率上都最优；"更多帧"（C）在弯曲轨迹上放大误差、不可取。120Hz 下直线 pred% 从 100%→58%（A），说明 idle/翻转阈值需要随刷新率与噪声自适应——列入 iPad 调参项，本轮不改。

## iPad 实测步骤（两种方式，均临时启动、测完即停）

### 方式 A：iPad 作为笔记本的外接手写屏（spacedesk / Duet Display 等）

1. Windows 笔记本安装 spacedesk（免费）或 Duet Display，iPad 装对应 App，连接后 iPad 成为 Windows 扩展屏。
2. Windows 浏览器打开 dev 页（先按方式 B 的第 1-2 步启动本地 dev，或直接 `npm run dev` 后访问 http://localhost:5173），把窗口拖到 iPad 那块屏。
3. 用 Apple Pencil 在该屏书写。注意：转发软件通常把 Pencil 映射成 Windows 触摸/笔，**面板里先看 pointerType 实际是什么**（决定走哪档容差），且此类方案会引入额外传输延迟，手感结论只做参考，不与方式 B 横比。
4. 测试完关闭转发软件。

### 方式 B：iPad 浏览器访问局域网 dev 服务器（推荐：真实 PointerEvent 与延迟）

1. Windows 上 `ipconfig` 查局域网 IPv4（下例 `192.168.1.23`），iPad 与笔记本同一 Wi-Fi。
2. 临时启动（显式绑定该 IP，**不改 vite.config 默认值，不绑 0.0.0.0**）：
   `npm run dev -- --host 192.168.1.23`
3. Windows 防火墙弹窗选"允许（专用网络）"；iPad Safari 打开：
   `http://192.168.1.23:5173/?ink-debug=1&ink-smooth=1&ink-predict=1&ink-ghost=1&ink-capsule=1&ink-tolerance=1&ink-wet-inc=1`
4. **不要启动 `npm run mcp`，MCP 端点不暴露**；只跑这一个 dev 进程。
5. 测完在笔记本 Ctrl+C 停掉服务器（不常驻、不写进任何配置）。

### 手感验收清单（开着面板逐项看）

1. **跟笔延迟**：预测开 vs 关画长直线/快弧线，墨迹前缘与笔尖的分离应明显减小；急转弯/停顿时预测应自动消失，不得出现"墨迹甩尾"（对应门控 sharp/jitter/idle）。
2. **预测尾观感（新）**：`ink-ghost=1` 时预测尾应是半透明浅色独立路径、从笔尖伸出，与实墨明显可区分；关闭 ghost 时与实墨同色。两种观感各试快/慢笔画。
3. **刷新率自适应（新）**：面板看"帧间隔 ≈ xx Hz"；iPad（通常 60Hz）下预测尾约 2 帧长度，步长不再是固定 11ms 的颗粒感；急转/慢速时尾应收缩或消失。
4. **平滑**：快速画锯齿线，毛刺减少；起笔/收笔端点仍在笔尖起止位置（端点精确保持）。
5. **湿/干一致（新）**：`ink-wet-inc=1` 开关下画长笔画（尽量 1000+ 点），抬笔瞬间墨迹形状**不应有任何跳变**（增量与烘焙逐位一致）；再对比关闭增量时画同样笔画，观感应相同。
6. **点按 vs 短笔画（新）**：快速轻点 → 圆点；放慢速度画一条刻意短 tick（约 0.5s）→ 应保留为短笔画而不是被折叠成点（位移+时长双条件）。
7. **橡皮**：快速横扫细线条，胶囊开时无漏擦；容差开关开时，手指擦除比鼠标明显更"宽容"（10 vs 3 DIP），笔居中（5 DIP）。
8. **缩放**：2×/4× 放大后重复橡皮与轻点，屏幕手感应一致（阈值按缩放换算）。
9. **压感**：面板显示"无压感（恒 0.5/0）"时笔画宽度不随力度变化；有真实压感的设备显示"真实压力"。
10. **性能**：面板帧间隔 <16.7ms（60Hz）且 move 处理耗时 <1ms（基准显示 ~0.01-0.4ms）；快速画超长笔画（2000+ 点）不卡顿，增量开启时尤其应平稳。
11. **回归**：六个开关全关（或无参数的普通链接）时，书写/橡皮与 main 完全一致。

## 未验证

- iPad 实测（方式 A/B 均未在本会话执行——按约束不自动启动服务器）；spacedesk/Duet 把 Apple Pencil 映射成哪种 pointerType 未知。
- 真机手感：ghost 预测尾的透明度（0.4 为拍脑袋值）与宽笔观感、自适应步长在真实 60/120Hz 屏上的颗粒感、增量湿墨在 React 批处理下的实际表现。
- 回放评估全部基于**合成轨迹**（高斯噪声、理想参数曲线）：真实 Apple Pencil 采样噪声分布、压力、掌部抑制等未建模；候选常数（B/D 组）只是初值候选，未经真机验证。
- rAF 刷新率估计在 iPad Safari（省电模式降帧）与后台切换时的行为（代码已 clamp，未实测）。
- Firefox/Safari 的自研预测兜底在真实浏览器中的表现。
- 打包体积/生产构建（按约束未跑）；与同机 OCR 计时任务的相互干扰未测量。

## 建议下一步

1. 用方式 B 在 iPad 上跑一遍验收清单，按面板数字手调常数：`predict.ts`（门控角度、卡尔曼 q/r、`ADAPTIVE_FRAMES_AHEAD`）、`tolerance.ts` 三档与 `TAP_MAX_DURATION_MS`、ghost 的 opacity。回放结论支持从 **B-更响应** 组起步。
2. 门控阈值随刷新率/噪声自适应（120Hz 回放显示直线被过度门控：idle 与翻转阈值应按帧间隔换算）。
3. 若 ghost 观感成立，考虑给预测尾再加"长度随速度缩放"（快笔画更长、慢笔画更短）。
4. 增量湿墨验证后，可把"湿墨分段增量重绘"进一步推进到 DOM 层（只更新新增 path 而非重建整个 StrokeShape），当前实现的收益主要在平滑计算，DOM 更新仍是整笔。
5. 若采纳平滑/容差，把实验开关转为正式设置项并评估默认值（笔=开、触摸=保守）。
