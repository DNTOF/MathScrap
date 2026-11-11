# 贡献指南

感谢关注 MathScrap。本文件说明如何在本仓库报告问题、做本地检查，以及提交拉取请求。使用方法、命令对照和产品行为以 [README.md](./README.md) 为准。

## 许可与第三方归属

本仓库以 [Apache License 2.0](./LICENSE) 授权，版权人是 DNTOF。请同时阅读根目录 [NOTICE](./NOTICE)。

NOTICE 说明：随包的手写公式权重是第三方文件，归属见 [`public/models/comer/NOTICE.md`](./public/models/comer/NOTICE.md)，对应 CoMER（ECCV 2022）模型以及 ink-on 以 Apache-2.0 分发的权重。MathScrap 不重新许可这些文件。改到模型、NOTICE 或相关说明时，请保持这段归属完整，不要把第三方权重改写成本项目自己的作品。

向本仓库提交的代码，默认按同样的 Apache-2.0 条款贡献。

## 本地开发

需要 Node.js。仓库里已经带有编译好的 `src/wasm/pkg`，只改页面时不必安装 Rust。改了 `crates/mathcore` 才需要 Rust 1.90（见 [`rust-toolchain.toml`](./rust-toolchain.toml)，当前是 `1.90.0`）和 wasm-pack，然后再运行 `npm run build:wasm`。

```bash
npm install
npm run dev
```

开发服务器是 `http://127.0.0.1:47321`。`npm run preview` 用 `47322` 预览生产构建。不要把 `npm run dev` 暴露到公网：开发桥没有单独口令，能访问开发端口的人可以改正在打开的纸面。

常用检查（与当前 `package.json` / README 一致）：

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | oxlint，有警告也失败 |
| `npm run build` | 类型检查并构建 `dist/` |
| `npm run test:rust` | 只跑 `crates/mathcore` 的 Rust 测试 |
| `npm run smoke` | 用仓库里的 WASM 检查数值、对数和图上是否有点 |
| `npm run smoke:ocr` | 手写预处理和假的编码器/解码器，不加载 ONNX |
| `npm run ocr:live` | 本机用仓库里的 CoMER INT8 读几笔样例 |
| `npm run smoke:ai` | 本地假接口上的连接测试、工具和 MCP |
| `npm run test:pack` / `npm run test:i18n` | 打包元数据，以及中英词条、语言记忆 |
| `npm run smoke:ink` | 笔迹命中、缩放坐标和撤销栈 |
| `npm run e2e` / `npm run e2e:sheet` / `npm run e2e:ink` | 需要先开着 dev 服务器 |

改到打包 MCP 相关 crate 时，还可在本地运行 `cargo test --manifest-path crates/mcpserve/Cargo.toml`（这是 CI 全量作业里的一步，`package.json` 目前没有对应的 npm script）。

安装包、签名和发布步骤以 README 的「安装包」一节以及 `docs/` 下现有说明为准。本文件不把打包、签名或发布当成已经在每台机器上可复现的默认贡献流程。

开发态 MCP：外部程序需要同时开着 `npm run dev` 和本机页面；stdio 服务器用 `node --import tsx mcp/server.ts`，工作目录是仓库根。不要把 `npm run mcp` 当作 MCP 客户端的 command。打包后的 MCP 测试构建不是已签名的 v0.0.1，也不会替换已安装的正式应用，说明见 [`docs/packaged-mcp.md`](./docs/packaged-mcp.md)。

## 手写测试：模拟与真实模型

这几项测的不是同一件事，也不要据此声称新增了识别准确率或覆盖率：

- `npm run smoke:ocr`（`scripts/ocr-smoke.ts`）走模拟会话：预处理、词元清理和脚本化的编码器/解码器，不加载真实 ONNX。
- CI 全量还会跑 `npx tsx scripts/ocr-real-smoke.ts`：加载仓库里的 CoMER INT8，笔画是合成折线，不是扫描的真实手写；输出的是模型置信度，不是准确率。缺少模型文件或哈希与 `scripts/ocr-model-pins.json` 不符都算失败，不能当作通过。
- `npm run ocr:live` 在本机用随包权重读样例笔画，便于人工查看，不是完整的手写评测集。

## 报告问题

请说明：如何复现、期望结果、实际结果、运行环境（操作系统、Node 版本、浏览器或使用的是开发服务器还是包装后的应用），以及不包含秘密的日志或截图。

不要在 issue、评论、日志或截图里粘贴 API 密钥、会话令牌、证书、私钥、口令，或 AI 接口密钥。设置里的密钥只应留在本机（README 中的 `mathscrap.ai.v1`），密钥不会、也不应交给 MCP。

## 提交代码时不要带进仓库的内容

不要提交 API 密钥、私钥、证书、口令、会话令牌，或签名材料。Windows / Android 签名只通过环境变量读取（例如 README 中的 `WINDOWS_CERTIFICATE`、`WINDOWS_CERTIFICATE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`、`ANDROID_KEY_BASE64`），脚本不应打印它们，仓库里也不应出现这些文件。

## 拉取请求与 CI

请从当前 `main` 拉出分支，把拉取请求指向 `main`，并写清改了什么、本地跑过哪些检查。不要绕过分支保护，也不要改保护规则。

指向 `main` 的 pull request，以及推送到 `main` 或 `cursor/mathscrap-packaging-*` 的提交，会运行 `.github/workflows/package.yml`。作业开始时由 `scripts/ci-scope.mjs` 分类，必查状态是名为 `test` 的作业：

- **全量（`full`）**：功能、依赖、构建、测试脚本、工作流或上述内容与文档的混合改动，都要跑完整测试套件。分类器把新增、删除、重命名、类型变化或无法按字段识别的改动也视为需要全量。全量步骤包括：`npm run lint`、`npm run test:rust`、`cargo test --manifest-path crates/mcpserve/Cargo.toml`、`npm run smoke`、`npm run smoke:ocr`、`npx tsx scripts/ocr-real-smoke.ts`、`npm run smoke:ai`、`npm run test:pack`、`npm run smoke:ink`，然后拉起开发服务器，再跑 `npm run e2e:sheet`、`npm run e2e:ink` 和 `npm run e2e`。请在合并前于本地尽量跑齐与改动相关的上述检查；涉及功能时不要只跑文档检查。
- **轻量（`light`）**：仅当本次差异全部是对已有 [`README.md`](./README.md)、`docs/` 下文件或 `signing/` 下 Markdown 的修改，或白名单版本文件里只有版本字段变化时才会出现。此时运行 `node scripts/ci-version-check.mjs`，这是必要的一致性检查，不是跳过检查。根目录新增 `CONTRIBUTING.md` 目前不在文档路径白名单里，会被当作新增文件而走全量。

网页包、debug APK 和 Windows 安装程序只在非 `pull_request` 的推送上、并且 `test` 通过之后构建；面向 `main` 的 pull request 不打安装包。这些 workflow 不创建 GitHub Release。`.github/workflows/mcp-test-build.yml` 只在 `cursor/packaged-mcp-*` 分支或手动触发时运行，不会因为推送到 `main` 而启动。
