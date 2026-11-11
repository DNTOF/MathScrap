# 打包后的 WebView

这一轮没有在打包好的窗口里跑过。Linux 上的 CI 只跑了 `test`。`web`、`android`、`windows` 在 pull request 上是跳过的，不是通过。

`src-tauri/tauri.conf.json` 里的 CSP 仍有 `https:`。打包后的页面直接 `fetch` 用户填写的 AI 地址，开发时代理不会打进安装包。`script-src` 保留 `wasm-unsafe-eval`，这是本机 ONNX WASM 要编译所需要的。`'unsafe-eval'` 已经去掉。

在 Windows 或 Android 上核对时，用一次本地未签名构建，不要改已经发布的 v0.0.1：

1. 打开应用，写一个短公式，点「识别」或按 R。公式模型仍应能给出候选。这只说明 ONNX 还在工作。
2. 在设置里填写一个你自己的 HTTPS 模型地址并测试连接。记下是连上了，还是控制台出现 CSP 拒绝。
3. 不要把自签证书装进受信任的根，也不要关闭系统的签名检查。

# Packaged WebView

This change did not run inside a packaged window. Linux CI ran `test` only. On a pull request, `web`, `android`, and `windows` are skipped. A skip is not a pass.

The CSP in `src-tauri/tauri.conf.json` still contains `https:`. The packaged page calls `fetch` on the AI URL the user typed. The dev proxy is not in the installed app. `script-src` keeps `wasm-unsafe-eval` so the local ONNX WASM can compile. `'unsafe-eval'` is already gone.

To check on Windows or Android, use one local unsigned build. Do not change the published v0.0.1:

1. Open the app, write a short formula, and press Recognize or R. A candidate means ONNX still runs. It is not a handwriting score.
2. In settings, enter an HTTPS model address you control and test the connection. Record whether it connects or the console shows a CSP refusal.
3. Do not install the self-signed certificate as a trusted root, and do not turn off signature checks.
