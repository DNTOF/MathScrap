# MathScrap

MathScrap 是一张连续的牛皮纸。笔迹和公式直接写在纸上，没有卡片，也没有贴在空白纸上的大块说明。右下角的坐标系把这张纸上能画的式子画进同一套坐标轴，并尽量推出交点、未知量和几何量。

MathScrap is one continuous sheet of kraft paper. Ink and formulas sit on the paper itself. There are no cards, and the blank sheet does not carry a large instruction panel. The coordinate button in the corner draws every plottable formula on that sheet onto one set of axes, and derives intersections, unknowns, and geometric quantities when it can.

计算在本机完成：浏览器或系统 WebView 里的 Rust/WebAssembly（`crates/mathcore`），手写公式走随包的 CoMER INT8 ONNX。界面有简体中文和 English。许可证是 Apache-2.0。

Computation stays on the device: Rust compiled to WebAssembly (`crates/mathcore`) inside the browser or the system WebView, and handwritten formulas go through the bundled CoMER INT8 ONNX models. The interface is Simplified Chinese and English. The license is Apache-2.0.

## 对数

## Logarithms

`ln` 是自然对数。单独的 `log` 和 `lg` 是常用对数，底数是 10。这三项不会被改成别的底。

`ln` is the natural logarithm. A unary `log` and `lg` are common logarithms, base 10. Those three are not silently given another base.

显式底数用这些写法，它们求的是同一个值：

Explicit bases use the forms below. They evaluate to the same value:

```
log_2(8)    log_{2}(8)    log₂(8)    log2(8)    log(2, 8)
```

`log(2)` 和 `log 2` 仍是 log₁₀(2)，不是以 2 为底。`lg` 不接受粘在后面的底数：`lg2(3)` 是 lg(2)·3。底数必须大于 0 且不等于 1，真数必须大于 0；否则实数结果是空的，图上不画穿过间断或渐近线的假线段。

`log(2)` and `log 2` stay log₁₀(2). They are not “base 2”. `lg` does not take a base glued to the name: `lg2(3)` is lg(2)·3. The base must be greater than 0 and not 1, and the argument must be greater than 0. Otherwise there is no real value, and the plot does not draw a fake segment across a gap or an asymptote.

解三角形时还会给出 X(91) 和 X(92)，分别是 X(47) 和 X(48) 的等角共轭。直角三角形里没有 X(92)。

Solving a triangle also reports X(91) and X(92), the isogonal conjugates of X(47) and X(48). A right triangle has no X(92).

## 快速开始

## Quick start

需要 Node.js。仓库里已经带有编译好的 `src/wasm/pkg`，只改页面时不必安装 Rust。改了 `crates/mathcore` 才需要 Rust 1.90 和 wasm-pack，再运行 `npm run build:wasm`。

Node.js is required. A built `src/wasm/pkg` is already in the repository, so Rust is not required for page-only changes. Rust 1.90 and wasm-pack are required only after editing `crates/mathcore`; then run `npm run build:wasm`.

```bash
npm install
npm run dev
```

开发服务器是 `http://127.0.0.1:47321`。`npm run preview` 用 `47322` 预览生产构建。

The dev server is `http://127.0.0.1:47321`. `npm run preview` serves the production build on port `47322`.

| 命令 Command | 作用 / What it does |
| --- | --- |
| `npm run dev` | 本机开发服务器，含 MCP 桥和 AI 转发。 / Local dev server, including the MCP bridge and the AI forwarder. |
| `npm run build` | 类型检查并构建 `dist/`。 / Typecheck and build `dist/`. |
| `npm run lint` | oxlint，有警告也失败。 / oxlint. Warnings fail the command. |
| `npm run test:pack` 或 `npm run test:i18n` | 打包元数据，以及中英词条、语言记忆。 / Packaging metadata, plus Chinese/English keys and saved language. |
| `npm run smoke` | 用真实 WASM 检查数值、对数和图上有没有点。 / Real WASM: numbers, logarithms, and whether a curve has points. |
| `npm run smoke:ocr` | 手写预处理和假的编码器/解码器，不加载 ONNX。 / Ink preprocess and a fake encoder/decoder. No ONNX. |
| `npm run ocr:live` | 本机用仓库里的 CoMER INT8 读几笔样例。 / Run the bundled CoMER INT8 on a few sample strokes. |
| `npm run smoke:ai` | 本地假接口上的连接测试、工具和 MCP。 / Connection test, tools, and MCP against a local fake endpoint. |
| `npm run test:rust` | `crates/mathcore` 的 Rust 测试。 / Rust tests for `crates/mathcore`. |
| `npm run smoke:ink` | 笔迹命中、缩放坐标和撤销栈。 / Ink hit testing, zoom coordinates, and the undo stack. |
| `npm run e2e` / `npm run e2e:sheet` / `npm run e2e:ink` | 需要先开着 dev。浏览器按 `CHROME_PATH`、Playwright 缓存、PATH，再按常见安装路径查找。`e2e:ink` 覆盖书写、擦除、撤销和中断。 / Need a running dev server. The browser is `CHROME_PATH`, then the Playwright cache, then PATH, then common install paths. `e2e:ink` covers writing, erasing, undo, and interrupted pointers. |
| `npm run build:wasm` | 把 Rust 重新编成 `src/wasm/pkg`。 / Rebuild Rust into `src/wasm/pkg`. |

## 纸面、公式和坐标系

## The sheet, formulas, and coordinates

打开是一张空白牛皮纸。应用名只出现在窗口标题和「… / More」菜单里。

The app opens on a blank kraft sheet. The name MathScrap appears in the window title and in the More menu.

- 笔、荧光笔、橡皮直接画在纸上。双击纸面、按 `/`，或点 Σ 再点纸面，就在该处写式子。Enter 写上，Esc 放弃。
- Draw with the pen, marker, or eraser. Double-click the paper, press `/`, or choose Σ and click, to write a formula there. Enter commits it. Esc discards it.
- 选择工具（V）拖动式子。手指在检测到手写笔之后负责平移和缩放。
- The select tool (V) drags a formula. After a stylus is detected, a finger pans and zooms.
- 右下角「坐标系 / Coordinates」把能画的式子画进同一套轴，图是半透明的小窗。点「详情 / Details」才展开式子列表和推导。
- Coordinates draws the plottable formulas on one set of axes, in a small translucent window. Details is what expands the formula list and the derivations.
- 同名未知数一起解。只写条件的行归到它前面的式子。平面和空间可以切换。缩放过的视野不会被新式子重置。
- Unknowns that share a name are solved together. A condition-only line belongs with the formula before it. Plane and space can be switched. A zoomed view is not reset by a new formula.
- 「…」里可以把示例写到纸上，也可以导出或导入一页 JSON（`mathscrap.sheet`）。文件里只有笔迹、式子和字条的字符串与数字，导入不会执行代码，也不会改写式子的文字。
- More can write the examples onto the sheet, and can export or import one JSON sheet (`mathscrap.sheet`). The file holds only strings and numbers for ink, formulas, and notes. Import does not execute the file and does not rewrite formula text.

纸面保存在本机 `localStorage` 键 `mathscrap.doc.v2`。第一次打开是空白纸。

The sheet is stored locally under the `localStorage` key `mathscrap.doc.v2`. The first open is a blank sheet.

## 语言

## Language

浏览器语言以 `zh` 开头时，界面初始是简体中文，否则是 English。右上角「… / More」里有一组紧凑的「中文 / EN」，选择写在 `mathscrap.lang`，下次打开仍用这个选择。空白纸上没有语言卡片。

If the browser language starts with `zh`, the interface starts in Simplified Chinese. Otherwise it starts in English. More contains a compact 中文 / EN control. The choice is stored in `mathscrap.lang` and is used again next time. The blank sheet has no language card.

切换语言会改按钮、菜单、对话框、占位符、提示、状态、面向人的错误，以及详情里的标题、分组和已收录的几何理由。不会翻译或改写公式、点名、已经写在纸上的内容、导入的纸，也不会改 MCP 工具名（`page_read`、`solve_analyze` 等）。计算引擎和 MCP 返回的原文仍是中文；只有屏幕上的显示会换成英文。个别较长的 Rust 句子还没有收录，英文模式下会仍以中文出现，详情底部有一句说明。

Switching language changes buttons, menus, dialogs, placeholders, hints, status text, user-facing errors, and the titles, groups, and listed geometry reasons in the details. It does not translate or rewrite formulas, point names, anything already on the sheet, or an imported sheet, and it does not change MCP tool names (`page_read`, `solve_analyze`, and the rest). The compute engine and MCP still return the original Chinese wording. Only the screen shows English. A few longer Rust sentences are not in the glossary and still appear in Chinese in English mode. The details panel says so at the bottom.

## 手写

## Handwriting

手写识别要点一下才开始：按 R，或点工具条上的识别。抬笔不会自动识别。先判断像不像算式。普通句子留在纸上，不送进公式模型。像算式才走本机 CoMER。置信度够就写成公式并更新角落的图，纸上没有确认条。设置里可以打开“写完稍停再认”。

Handwriting is recognized only when you ask: press R, or use the recognize button. Lifting the pen does not recognize it. A text gate decides whether it looks like a formula. Ordinary writing stays on the paper and is not sent to the formula model. Formula-like ink goes to the local CoMER model. A confident reading is written as a formula and the corner plot updates. There is no confirmation strip. Settings can turn on recognition after a short pause.

模型是 CoMER（ECCV 2022）的 INT8 ONNX，权重由 [ink-on](https://github.com/kimseungdae/ink-on) 以 Apache-2.0 分发。它能读一些清楚的短式，不能当作任意手写的完整识别器：认不出就保持笔迹，不会用 `y = x` 充数。单独的 `sigma` 是符号，求和与积分留在纸上，不因此打开坐标系。

The model is CoMER (ECCV 2022) INT8 ONNX. The weights are distributed by [ink-on](https://github.com/kimseungdae/ink-on) under Apache-2.0. It can read some clear short formulas. It is not a complete recognizer for arbitrary handwriting: a miss leaves the ink, and it does not substitute `y = x`. A lone `sigma` is the symbol. Sums and integrals stay on the paper and do not open the coordinate view by themselves.

模型把单独的 σ 读成 `0`、`Y` 或 `u`，而且笔迹本身像 σ 时，才改写成 `sigma`。公式、闭合的 0、u 形的碗和 Y 的分叉不会被改。求和号上下的两道横杠不当成字母上的箭头。

A lone σ that the model reads as `0`, `Y`, or `u` is rewritten to `sigma` only when the ink itself looks like σ. A formula, a closed 0, a u-shaped bowl, and a Y fork are left alone. The two bars of a summation are not treated as an arrow over a letter.

| 文件 File | 内容 / Contents |
| --- | --- |
| `public/models/comer/encoder_int8.onnx` | 编码器，约 3.4 MB。 / Encoder, about 3.4 MB. |
| `public/models/comer/decoder_int8.onnx` | 解码器，约 4.0 MB。 / Decoder, about 4.0 MB. |
| `public/models/comer/vocab.json` | 词表。 / Vocabulary. |
| `dist/ort/ort-wasm-simd-threaded.wasm` | 构建时从 onnxruntime-web 复制。运行时不再访问 node_modules 或公共 CDN。 / Copied from onnxruntime-web at build time. Runtime does not read node_modules or a public CDN. |

## AI 和 MCP

## AI and MCP

这两条路是分开的。

These are two separate paths.

设置里的 AI 接口是你自己的 OpenAI 兼容接口、Anthropic 或本机 Ollama。地址、模型名和密钥只在这台浏览器的 `mathscrap.ai.v1`。请求只发往你填的地址。密钥不进日志，也不交给 MCP。Base URL 或模型名还空着时，「测试连接」不会发请求。

The AI endpoint in Settings is your own OpenAI-compatible endpoint, Anthropic, or a local Ollama. The address, model name, and key stay in this browser under `mathscrap.ai.v1`. Requests go only to the address you entered. The key is not logged and is not given to MCP. Test connection sends nothing while the base URL or model name is still empty.

「帮我推一步 / Suggest a next step」把纸上的公式和你的一句请求发给那个模型。数值和几何仍由页面里的 Rust 工具计算。模型若不会函数调用，可以只返回 `{"add":["…"],"analyze":true,"note":"…"}`。

Suggest a next step sends the formulas on the sheet and one request to that model. Numbers and geometry are still computed by the Rust tools in the page. If the model cannot call tools, it may return only `{"add":["…"],"analyze":true,"note":"…"}`.

MCP 不保存密钥，也不调用那个聊天接口。工具名是稳定的：`page_read`、`page_add_formula`、`page_update_formula`、`solve_analyze`、`plot_open`、`plot_set_view`、`ink_read`。页面里可以调用 `window.mathscrap.tools.call(name, args)`。

MCP does not store the key and does not call that chat endpoint. The tool names are stable: `page_read`, `page_add_formula`, `page_update_formula`, `solve_analyze`, `plot_open`, `plot_set_view`, `ink_read`. The page can call `window.mathscrap.tools.call(name, args)`.

外部程序要同时开着 `npm run dev` 和本机页面。stdio 服务器是 `mcp/server.ts`，用 `node --import tsx mcp/server.ts` 启动，工作目录是仓库根。`MATHSCRAP_BRIDGE` 默认 `http://127.0.0.1:47321`。不要把 `npm run mcp` 当作 MCP 客户端的 command，npm 会往 stdout 打一行字，stdio 协议会坏。页面没连上时，`tools/call` 立刻返回错误，不会一直等。

An external program needs both `npm run dev` and the local page. The stdio server is `mcp/server.ts`, started with `node --import tsx mcp/server.ts` and the repository root as its working directory. `MATHSCRAP_BRIDGE` defaults to `http://127.0.0.1:47321`. Do not use `npm run mcp` as the MCP client's command: npm writes a line to stdout and breaks the stdio protocol. If the page is not connected, `tools/call` returns an error immediately.

开发服务器会把浏览器的模型请求经 `POST /__mathscrap/ai/forward` 转发，以免 CORS 拦住页面。转发只允许 GET/POST，路径要落到模型列表、对话补全或 Messages，并拒绝链路本地地址和云元数据主机。直接打开 `dist/` 时没有这个转发。桥没有单独的口令：谁能访问开发端口，谁就能让开着的页面改公式。不要把 `npm run dev` 暴露到公网。

The dev server forwards the browser's model request through `POST /__mathscrap/ai/forward` so CORS does not block the page. The forwarder allows only GET and POST, only model-list, chat-completion, or Messages paths, and it refuses link-local and cloud-metadata hosts. Opening `dist/` by itself has no forwarder. The bridge has no separate password: anyone who can reach the dev port can change formulas on the open page. Do not expose `npm run dev` to the public internet.

## 安装包

## Packages

外壳是 Tauri 2。它把 `dist/` 放进系统 WebView。安装之后不连接 Vite，也不从公共 CDN 拉数学库或 OCR。标识是 `app.mathscrap`，版本 `0.0.1`。图标用纸面的牛皮色 `#c9a473`。

The shell is Tauri 2. It puts `dist/` in the system WebView. After install it does not connect to Vite and does not fetch the math library or OCR from a public CDN. The identifier is `app.mathscrap`, version `0.0.1`. The icon uses the kraft color `#c9a473`.

| 命令 Command | 在哪里跑 / Where it runs | 得到什么 / What you get |
| --- | --- | --- |
| `npm run pack:web` | 有 Node 即可。 / Any machine with Node. | `dist/`。这是页面，不是安装包。 / `dist/`. This is the page, not an installer. |
| `npm run pack:windows` | Windows 10 1803+ 或 Windows 11，已有 WebView2、VS C++ 生成工具、Rust 1.90、Node。 / That Windows setup. | `packaging/out/` 里的 NSIS 安装程序和 `MathScrap.exe`。默认不签名。 / An NSIS installer and `MathScrap.exe` in `packaging/out/`. Unsigned by default. |
| `npm run pack:android` | JDK 17、Android SDK、NDK、Rust 的 Android 目标。 / JDK 17, Android SDK, NDK, and the Rust Android targets. | debug 签名的 APK，可以侧载。不是 Play 商店包。 / A debug-signed APK that can be sideloaded. Not a Play Store package. |
| `npm run pack:ios` | 只有 macOS 加完整 Xcode。其它系统会直接退出。 / macOS with full Xcode only. Other systems exit immediately. | 模拟器是 `.app`。没有描述文件和证书时不会做出可安装的 IPA。 / The simulator product is an `.app`. Without a profile and certificate it does not produce an installable IPA. |

Windows 安装程序不附带 WebView2 下载器。可选签名只认环境变量 `WINDOWS_CERTIFICATE`（pfx 的 base64）和 `WINDOWS_CERTIFICATE_PASSWORD`。脚本不打印它们，仓库里也没有证书。

The Windows installer does not bundle a WebView2 downloader. Optional signing reads only `WINDOWS_CERTIFICATE` (base64 pfx) and `WINDOWS_CERTIFICATE_PASSWORD`. The scripts do not print them, and the repository has no certificate.

Android 调试包用 SDK 的 debug keystore 签名。正式签名要已有的 keystore：`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`、`ANDROID_KEY_BASE64`。脚本不会生成 keystore。

The Android debug package is signed with the SDK debug keystore. A release signature needs an existing keystore: `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_BASE64`. The script does not generate a keystore.

iOS 最低系统是 15.0（arm64，例如 iPad Air 2 的 iPadOS 15）。笔迹和数学引擎在 15.x 上可用；手写识别在 iOS 16.4 以上用 WebAssembly SIMD；更旧的系统（没有 SIMD）自动改用 onnxruntime-web 1.18 的非 SIMD 兼容运行时，结果相同但慢数倍，自动识别暂停、改为手动点「识别」。兼容路径只在 Chromium 里模拟过，未在 iPad 真机验证。能装到别人手机上的 IPA 需要 Apple Developer 证书和描述文件：`IOS_CERTIFICATE`、`IOS_CERTIFICATE_PASSWORD`、`IOS_MOBILE_PROVISION`，或 `APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_KEY_PATH`。这里不注册开发者账号，不上传 TestFlight 或 App Store，也没有在 iPhone 上安装过。

The iOS minimum is 15.0 (arm64, for example iPadOS 15 on an iPad Air 2). Ink and the math engine work on 15.x; handwriting recognition uses WebAssembly SIMD on iOS 16.4 and later; older systems (no SIMD) fall back to onnxruntime-web 1.18's non-SIMD runtime, with the same results several times slower, automatic reading paused and Recognize done by hand. The fallback has been exercised in Chromium only, not on an iPad. An IPA that installs on someone else's phone needs an Apple Developer certificate and profile: `IOS_CERTIFICATE`, `IOS_CERTIFICATE_PASSWORD`, `IOS_MOBILE_PROVISION`, or `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`. This repository does not enroll a developer account, does not upload to TestFlight or the App Store, and has not been installed on an iPhone.

`.github/workflows/package.yml` 在推送到 `main` 或 `cursor/mathscrap-packaging-*` 时，以及指向 `main` 的 pull request 上运行。`test` 作业没有额外的跳过条件：这三种情况都会在 `ubuntu-latest` 上跑 `npm run lint`、`npm run test:rust`、`npm run smoke`、`npm run smoke:ocr`、`npm run smoke:ai`、`npm run test:pack`、`npm run smoke:ink`，然后拉起 dev 服务器，依次跑 `npm run e2e:sheet`、`npm run e2e:ink` 和 `npm run e2e`（逐条作图）。失败时上传 `e2e-shots`、`e2e-plots` 和 `dev-server.log`。这些步骤不需要密钥。网页、debug APK 和未签名 Windows 安装程序仍只在 push 上、并且 `test` 通过之后构建；pull request 不打安装包。`.github/workflows/package-ios.yml` 只在手动启动时使用 macOS runner。这些 workflow 不创建 GitHub Release。本文件不提供下载地址。

`.github/workflows/package.yml` runs on a push to `main` or `cursor/mathscrap-packaging-*`, and on a pull request into `main`. The `test` job has no extra skip condition, so all three of those runs execute it on `ubuntu-latest`: `npm run lint`, `npm run test:rust`, `npm run smoke`, `npm run smoke:ocr`, `npm run smoke:ai`, `npm run test:pack`, `npm run smoke:ink`, then a dev server, then `npm run e2e:sheet`, `npm run e2e:ink`, and `npm run e2e` (one plot per formula). On failure it uploads `e2e-shots`, `e2e-plots`, and `dev-server.log`. Those steps need no secrets. The web bundle, debug APK, and unsigned Windows installer still build only on a push, and only after `test` passes. A pull request does not build installers. `.github/workflows/package-ios.yml` uses a macOS runner only when started by hand. These workflows do not create a GitHub Release. This file does not publish a download URL.

## 许可和作者

## License and authors

Apache-2.0。见 [LICENSE](./LICENSE) 和 [NOTICE](./NOTICE)。版权人是 DNTOF。提交作者是 DNT_OF。

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE). The copyright holder is DNTOF. Commits are authored by DNT_OF.
