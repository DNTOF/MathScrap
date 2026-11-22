# comer-native（CoMER INT8 原生推理原型 · 第 1 轮）

目标：把 `public/models/comer`（encoder/decoder INT8 ONNX）+ `src/ocr` 的 TS 预处理/解码搬到 Rust（未来 Tauri 后端），彻底摆脱 WebView/wasm——iPadOS 15 Safari 无 wasm SIMD，现走 onnxruntime-web 1.18 非 SIMD compat 路径（慢数倍）。

**本轮（round 1）只做引擎可行性验证**，不改 Web 应用：新路径未来经 Tauri command 暴露（前端传笔迹 → Rust 预处理 + encoder/decoder + 按 TS 同样方式解码 → LaTeX+置信度），接入时默认关闭，沿用 `src/ocr/support.ts` 的 runtime 选择模式扩一个 `native` 档（`?ocr-native=1` / `localStorage mathscrap.ocr-native`，默认 `0`，与 `ocr-compat` 同款开关样式；MCP 仍仅桌面）。

## 现状（对照 TS 侧）

- 预处理：`crates/comer-native/src/preprocess.rs` ← `src/ocr/comer/preprocess.ts`（重采样/二次贝塞尔描线/AA 圆头笔刷/双线性缩放/mask，f64 计算落 f32，逐行移植）。
- 解码：`src/decode.rs` ← `src/ocr/comer/decode.ts`（encoder 一次 → beam=2 / maxSteps=40 / 3-重复熔断 / 长度归一排序；log-softmax f64）。
- 词表：`src/source.rs`（vocab.json → decodeTokens）。`latex = decodeTokens(ids).join(' ')`，模型置信度 = `exp(logProb/n)`（bind/sigma/repair/gate 等应用层后处理本轮未移植，对比口径 = decode 级 latex）。
- 引擎后端（feature 门控，二选一编译）：`--features ort`（pyke ort，原生 ONNX Runtime）与 `--features tract`（tract-onnx 纯 Rust）。

## 复现

```
# 基线（onnxruntime-web 1.22 wasm SIMD，产出 fixtures + latex/置信度 + 耗时）
npx tsx crates/comer-native/diagnostics/baseline.ts

# Rust parity + 耗时
cargo run -p comer-native --features ort   -- --models public/models/comer --fixtures crates/comer-native/fixtures/fixtures.json
cargo run -p comer-native --features tract -- --models public/models/comer --fixtures crates/comer-native/fixtures/fixtures.json
```

fixtures（13 条）= ocr:live 同款样本：inkFixtures(3)/inkFixtures(5)（y=2、y=x、a²=b、½）+ arrow/sum/sum-bar/sigma/point。

## 模型算子需求（grep ONNX protobuf 确认）

| 模型 | 需要 |
|---|---|
| encoder_int8.onnx | ConvInteger ×100、DynamicQuantizeLinear ×100 |
| decoder_int8.onnx | MatMulInteger ×25、DynamicQuantizeLinear ×24、Trilu ×5、ConvInteger ×4 |
| decoder_int8_compat.onnx | 同上（WebKit 非 SIMD ort-web 1.18 用；grep 仍见 Trilu 字样，实际节点已替换） |

## 断点 / 已知问题（第 2 轮更新，2026-11-14）

### 引擎可行性结论（第 2 轮：两引擎 13/13 全跑完）

| 引擎 | 加载 INT8 | top-1 latex vs 基线 | 单条耗时（本机 release） | 判定 |
|---|---|---|---|---|
| **ort 2.0.0-rc.10**（pyke 预编译 ORT，GraphOptimization=Level3） | ✅ ConvInteger/MatMulInteger/DynamicQuantizeLinear/Trilu 全部原生支持 | **13/13 一致**（第二 beam 偶有近平手重排，confΔ≤4.2e-2） | enc 28.8–77.9ms，**全程 35.1–205.9ms**（首跑均值 113.3ms，repeat 最快 35.1ms）；preprocess 均值 689µs | **推荐，可行** |
| tract-onnx 0.22.5（纯 Rust，含 multithread-mm） | ✅ 两个绕法后可跑 | **13/13 一致**（第 2 轮修复 plan 冲突后全通过） | 全程 **2.1–9.3s**（enc 1.1–2.3s，大头在 decoder 逐步循环） | 可行但慢 ~30–60×，不推荐生产 |
| onnxruntime-web 1.22（wasm SIMD，基线） | ✅ | —（基线） | decode 114–580ms/条 | 现状 |

第 1 轮的 tract 中断（3/13 后 `Clashing resolution for expression. 20=20 != 8`）已定位：**plan 缓存 key 太粗**——decoder 的 `encoder_features` 首维（行数）在不同宽度下相同、第二维（列数）不同，W=128 复用了 W=320 的 plan。修复：plan key 改为**全部 feed 维度签名**（`input_ids` 归一到定长）。

### tract 的坑（绕法均已写进 `tract_engine.rs`）

1. ONNX 中间张量的 value_info 提示硬编码 `Sym("width")`，与具体输入 fact 在 Slice 节点冲突（`Impossible to unify Val(320) with Sym(width)`）——`with_ignore_output_shapes` 只管模型输出，**不管 value_info**；绕法：加载后清空全部内部 outlet fact（保留 Source/Const），由求解器重推。
2. tract 无法分析流式维度上的 StridedSlice（`Streaming dimensions with strides are not supported`）——必须配具体输入 fact。
3. 输出名要用 **outlet label**（"encoder_features"）而非节点名。
4. decoder 形状特化：`input_ids` 定长 padding（max_steps+1），Trilu 因果掩码保证 L-1 位置 logits 不受尾部 padding 影响（compat 解码器同款思路）。
5. plan 缓存 key 必须用**全形状签名**（第 2 轮修复，见上）。
6. 性能实验（第 2 轮）：`into_optimized` + 全具体形状已是现状；启用 `tract-linalg/multithread-mm`（rayon）后最快 3.3→2.1s——瓶颈在 decoder 逐步循环的 attention/逐算子开销与 tract 的通用 INT8 执行路径，多线程 matmul 帮助有限；`ignore_output_shapes` 只影响加载（关掉会复现统一冲突，对运行速度无影响）。结论不变：生产用 ort。

### 跨平台 cargo check（Windows 主机，rustc 1.90，目标 std 已安装）

| 目标 | tract | ort |
|---|---|---|
| x86_64-pc-windows-msvc | ✅ check 通过 | ✅ check 通过 + 实跑 |
| aarch64-apple-ios | ❌ cc-rs 找不到 `clang`/`xcrun`（tract-linalg 需 macOS 工具链编 ARM 汇编） | ❌ ort-sys 无 iOS 预编译二进制（需自行编译 ONNX Runtime 并链接） |
| aarch64-linux-android | ❌ 找不到 `aarch64-linux-android-clang`（需 NDK） | ❌ ort-sys 无 android 预编译二进制（同上） |

补救路径：iOS 上 tract 在 macOS 工具链下可查；Android 需 NDK；ort 两平台均需自编译对应平台 libonnxruntime 并用 `load-dynamic`/静态链接接入——列为下轮工作。

### 一致性细节

- 预处理张量与基线**非逐位一致**：最大像素差 ≤2.05e-2（JS `Math.hypot` 与 f64 `sqrt` 的 ULP 差异经重采样累积），13/13 解码文字不受影响；mask 求和完全一致。
- 置信度差 confΔ ≤4.2e-2，出现在第二 beam 近平手处（如 a2-eq-b-w5：`a ^ { 2 } = b \cdot b`(0.414) vs 基线 `a ^ { 2 } = b b`(0.372)），top-1 全部稳定。
- `pass=13 fail=0` 的判定口径 = **top-1 latex 与基线完全一致** 且 mask 校验和一致；张量位级差异单独上报（见 `ort-run-out.txt` / `tract-run-out.txt`）。

## 第 4 轮（2026-11-14）：beam 对齐诊断 + Tauri 真调用实测 + 前端单测 + 推送前清单

### 1) 第二 beam 与候选列表对齐（诊断结论）

对 a2-eq-b-w5（唯一分歧 fixture）做了**两后端逐 step logits dump**（`diagnostics/beam-dump.ts` ↔ `cargo run -- --dump-beam`，存档 `beam-dump-web.txt` / `beam-dump-native.txt`）：

- **argmax 路径完全一致**：真实解码序列每步 top-1 两后端相同（=, b, 2, }, =, b, <eos>）。
- **原始 logits 系统性不同**：同一步的数值差可达 ~2.4（如 L=6 的 `b`：wasm 17.87 vs native 20.24；L=1 的 `=`：12.15 vs 12.91），中低排名的 token 互换。
- **根因**：INT8 量化算子（ConvInteger/MatMulInteger/DynamicQuantizeLinear）在不同执行后端（wasm SIMD vs 原生 AVX CPU EP）的 kernel 实现（累加顺序/反量化舍入）数值不同。第二 beam 的两条分支分数差 ~0.042，落在该数值差异范围内 → 分支翻转。**这是后端 kernel 差异，不是移植 bug，也不可通过修改解码代码逐位修复**（除非改用 float32 模型文件——超出本轮范围且会改变模型精度特性）。
- 影响面：仅第二 beam 候选的文本与置信度（top-1 与 text 级输出 13/13 不受影响）；top-1 后置信度差 confΔ≤4.2e-2。

### 2) 桌面 Tauri 真实调用实测（`src-tauri/tests/native_ocr.rs`，debug 构建 + `--features native-ocr`）

直接驱动与 IPC 相同的命令实现 `ocr_native_recognize`（OnceLock 管线，无 State 依赖；窗口/IPC 跳转未模拟）。13/13 **top-1 text 与基线一致**，test ok：

| 指标 | 数值 |
|---|---|
| 首次调用（含模型加载 + ORT 初始化） | **552.1 ms** |
| 一次性加载（首调 − warm 均值，估计） | ≈ 421.9 ms |
| warm 调用 | min **62.5 ms** / avg 130.2 ms |
| 单条最重（point-w3 首跑） | 277.8 ms |
| 进程峰值内存（PeakWorkingSet） | **147.3 MB** |

命令行：`cargo test --manifest-path src-tauri/Cargo.toml --features native-ocr --test native_ocr -- --nocapture`

### 3) 前端单测（`src/ocr/comer/native.test.ts`，node:test + tsx）

5/5 通过：开关解析（URL/localStorage/0-false-off 优先级）、非 Tauri 环境原生永不执行、opt-in+Tauri 时命令与参数正确、flag 关闭时原生命令零调用（默认路径不变）、**原生报错回退 web**（断言拒绝来自 web 加载尝试而非原生错误）。

### 4) 推送前检查清单（本轮只列，未提交）

**应纳入提交：**
- `crates/comer-native/`：`Cargo.toml`、`Cargo.lock`、`.gitignore`、`README.md`、`src/**`（含单测）、`fixtures/fixtures.json`（基线输入+期望，可复现 parity）、`diagnostics/{baseline.ts,beam-dump.ts}` 与 `diagnostics/beam-dump-{web,native}.txt`（对齐证据）、`{ort,tract}-run-out.txt`（耗时存档，可选提交）。
- `src-tauri/`：`Cargo.toml`（+comer-native 依赖/native-ocr feature）、`Cargo.lock`、`src/lib.rs`（handler 注册）、`src/ocr_native.rs`（命令）、`tests/native_ocr.rs`。
- 前端：`src/ocr/comer/native.ts`、`native.test.ts`、`web.ts`（原生分支 + toInk 导出）。
- `.github/workflows/rust-ocr-native-wip.yml`（workflow_dispatch 手动触发，不影响 release 流程）。
- `.gitignore` 追加的本地产物条目。

**不应提交（已写进 .gitignore）：**
- `.ort-mobile/`（本机下载的官方 AAR/dylib，可由 CI 或命令重新获取）、`tauri-test-out.txt`、`crates/comer-native/*-run-stderr.log`、各 `target/`。
- 运行输出 `tract-run-out.txt`/`ort-run-out.txt`：二选一——提交作证据，或忽略（命令可重跑）；当前 `.gitignore` 未忽略它们（默认提交）。

**workflow 触发**：`rust-ocr-native (WIP)` 只有 `workflow_dispatch`（Actions 页手动 Run workflow）；无 push/PR 触发器，不影响 `package.yml`/`package-ios.yml`/`mcp-test-build.yml`。

**提交前最后动作建议**：`cargo test -p comer-native`、`npm run smoke:ocr`、`cargo test --manifest-path src-tauri/Cargo.toml --features native-ocr --test native_ocr`、`npx tsx --test src/ocr/comer/native.test.ts` 四条全绿后再 commit。

## 第 3 轮（2026-11-14）：全链路移植 + Tauri 命令 + 移动端官方预编译包

### Rust 侧

- **crate 拆为 lib + bin**：`src/lib.rs` 暴露全部模块；CLI 保留为 parity runner。
- **后处理全量移植**（与 TS 逐行对应）：`repair.rs`（brace/frac/sqrt 修复）、`bind.rs`（bindInk/findOverArrow/looksLikeSumBars/pointOf）、`sigma.rs`（sigma 专属几何判定 + repairIsolatedSigma）、`gate.rs`（gate 版 looksLikeIsolatedSigma）、`source.rs` 增 tokensToSource（∑/∫ 限界、希腊字母命名、frac/sqrt/vec 展开）、`engine.rs`（recognizeStrokes 全链路 + agreeConfidence）。
- **parity 升级到 text 级**：runner 同时对比 decode 级 latex 与 bind/sigma/agree 后的 `{text, confidence}`（即 ocr:live 断言的口径）。`pass=13 fail=0`，**text top-1 13/13 一致**（`maxTextConfΔ=1.94e-2`），decode latex 13/13（第二 beam 近平手重排仍存在，top-1 稳定）。数据：`ort-run-out.txt`。
- **cargo test**：10 个纯 Rust 单测全过（repair/latex 结构、tokensToSource、bind/collapse 语义、flag 解析——在 `src/*_test`/`#[cfg(test)]`）。
- **耗时（release，ort Level3，13 fixtures）**：单条全链路（预处理+推理+后处理）**31.8–141.6ms**（最重 point-w3 141.6ms，最轻 sum-w3 31.8ms）；encoder 25.2–84.1ms；预处理均值 ~0.5ms。

### Tauri 命令与前端开关

- 命令 `ocr_native_recognize`（strokes → `{text, confidence, latex}[]`）加在**现有** Tauri 壳 `src-tauri` 上；编译 feature `native-ocr` **默认关闭**（关/开两态 `cargo check` 均 0 error）。模型以 `include_bytes!` 内嵌（encoder+decoder+vocab ≈7.6MB）。`lib.rs` 其余逻辑（MCP 等）未动。
- 前端 `src/ocr/comer/native.ts`（新）+ `web.ts`（最小分支）：双门控 = `?ocr-native=1`（URL，`0/false/off` 可显式关）或 `localStorage mathscrap.ocr-native=1` **且** 检测到 `window.__TAURI__`；原生失败（含命令不存在/超载/识别异常）自动回退现有 onnxruntime-web 路径。默认全关，行为与 main 一致；`classifyInk`/`support.ts`/默认引擎未动。
- `npm run smoke:ocr` 全过（mock 口径回归不受影响）。`tsc -p tsconfig.app.json` 有 6 个**预存**错误（junction 的 node_modules 缺 `@tauri-apps/api`——node_modules 来自主仓 main，本分支 package.json 里有该依赖；非本轮改动引入，报错文件与本次改动无关）。

### 移动端构建（官方预编译包，不自编 ORT）

| 组合 | 本机（Windows） | CI（WIP workflow） |
|---|---|---|
| aarch64-linux-android + ort,load-dynamic | ✅ **check 0 error**（官方 Maven AAR 1.22.0 解包 `libonnxruntime.so` + `ORT_LIB_LOCATION`） | ✅ ubuntu + NDK（`rust-ocr-native-wip.yml` android job） |
| aarch64-apple-ios + ort | ⚠️ 0 error——但用的是官方 osx-arm64 dylib **占位**（仅证明 Rust 代码可编 iOS 目标；真链接需真 iOS 库） | ✅ macos-14：CocoaPods `onnxruntime-objc` 1.22.0（官方 iOS 分发渠道）→ 静态 framework 拷为 `libonnxruntime.a` + `ORT_LIB_LOCATION` 静态链接 |
| x86_64-pc-windows-msvc | ✅ check + 全量 parity 实跑 | ✅ desktop-parity job（三 OS） |

- WIP workflow：`.github/workflows/rust-ocr-native-wip.yml`，**仅 workflow_dispatch 手动触发**，不碰现有 release 流程；iOS/Android 均不自编 ORT（iOS=CocoaPods 官方包、Android=Maven 官方 AAR）。
- 本机下载存档：`.ort-mobile/`（Maven AAR + osx-arm64 tgz，未纳入提交）。

### 第 3 轮未验证 / 风险

- 真机（iPad/iPhone/Android 设备）推理与耗时未测；iOS 静态链接只在 CI pod 环境成立（本机用 macOS 占位库）。
- `@tauri-apps/api` 类型缺失导致的 6 个 tsc 错误为 node_modules 环境差异（预存）；在正确 npm install 的环境应消失——未在本机重装验证。
- 第二 beam 全列表 parity（近平手重排）仍未对齐；`npm run dev`/Tauri 真窗体验未跑（约束不启常驻服务）。
- native 会话加载 ~一次性 include_bytes（内存常驻 ≈8MB）+ ORT 初始化；移动端内存峰值未测。
