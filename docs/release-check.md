# 安装后核对

这些说明只在源码分支里。已经发布的 v0.0.1 页面没有改。

手写识别只在你点「识别」或按 R 时运行。先看笔迹是不是一行字；一行字不会被送进公式模型。公式模型是本地的 CoMER INT8。自动测试用的是程序画出的折线，不是扫描的手写。空白和很小的噪点不会出字。这次实测的合成结果是：`y = 2`（0.97）、`Y = x`（0.75，模型把 y 读成大写）、`(1)/(2)`（0.97）、`a^2 = b`（0.97）、`\sum`（0.84）、`sigma`（0.78）、最高 `A(2, 2)`（0.95），第二名 `A(2, 2, 2)`（0.76）仍是已知的多余坐标。写入线是 0.62。没有附带可再分发的真人笔迹样本，所以不能把这些结果说成手写准确率。门先看笔迹结构，不认识中文或英文。一行或两行普通笔迹不会送进公式模型。有等号、分式、上标、括号、求和、sigma 或箭头的才是公式。数字是模型置信度，不是准确率。

开发时的桥需要 HttpOnly 会话 cookie。伪造 Origin 或 Sec-Fetch-Site 拿不到它。浏览器在打开页面时拿到 cookie。stdio 客户端读一个 0600 文件，不会把内容打印出来。局域网要另设一串足够长的分享口令，并 POST 到 `/__mathscrap/join` 才换到 cookie。太短或占位口令不会打开分享。同一台机器上伪造一次“打开页面”的请求仍可能拿到 cookie，同一用户也能读那个文件。模型文件的 SHA-256 记在 `scripts/ocr-model-pins.json`。缺文件或哈希不对，测试失败，不会算通过。

Windows 安装包是本机自签，时间戳是 DigiCert RFC3161。系统会显示未知发布者。不要把这个证书装进受信任的根，也不要关掉系统的签名检查。Android 包是 release，arm64，不是调试包。

核对已发布文件时，在你自己的电脑上计算 SHA-256，和发布页上的 `SHA256SUMS` 比较：

```
MathScrap-0.0.1-windows-x64-setup.exe
MathScrap-0.0.1-windows-x64.exe
MathScrap-0.0.1-android-arm64-v8a.apk
```

Git 标签 `v0.0.1` 的签名可以在本地用随包的公钥检查。签名 UID 是 `DNT_OF`，UID 上没有邮箱。标签对象里的 tagger 邮箱是 `3174600270@qq.com`。这是两个不同的字段。签名有效不等于 GitHub 上显示 Verified。

# After you install

These notes live in the source branch. The published v0.0.1 page was not changed.

Handwriting recognition runs when you press Recognize or R. A line of writing is not sent to the formula model. The formula model is local CoMER INT8. The automated cases use strokes drawn by the program, not scanned handwriting. Blank ink and tiny noise produce no text. The synthetic readings this run actually produced are `y = 2` (0.97), `Y = x` (0.75; the model capitalized y), `(1)/(2)` (0.97), `a^2 = b` (0.97), `\sum` (0.84), `sigma` (0.78), and top `A(2, 2)` (0.95). A weaker second candidate `A(2, 2, 2)` (0.76) is still the known extra-coordinate miss. The write line is 0.62. There is no redistributable sample of a real person's handwriting here, so these results are not a handwriting accuracy claim. Model SHA-256 values are in `scripts/ocr-model-pins.json`. A missing file or a different hash fails the test.

The Windows installer is self-signed, with a DigiCert RFC3161 timestamp. The system shows an unknown publisher. Do not install that certificate as a trusted root, and do not turn off signature checks. The Android package is a release build for arm64, not a debug build.

To check the published files, hash them on your own computer and compare with `SHA256SUMS` on the release page:

```
MathScrap-0.0.1-windows-x64-setup.exe
MathScrap-0.0.1-windows-x64.exe
MathScrap-0.0.1-android-arm64-v8a.apk
```

The `v0.0.1` tag signature can be checked locally with the published public key. The signing UID is `DNT_OF` and that UID has no email. The tagger email stored on the tag object is `3174600270@qq.com`. Those are different fields. A valid signature is not the same as a GitHub Verified badge.

The packaged WebView still allows `https:` in `connect-src`, because a configured AI endpoint is fetched by the page itself. `script-src` keeps `wasm-unsafe-eval` for ONNX and drops `'unsafe-eval'`. That CSP line has not been executed inside a packaged WebView in this change, and CORS for a packaged build has not been run. The dev bridge requires an HttpOnly session cookie. Forged `Origin` and `Sec-Fetch-Site` headers do not grant it. The browser receives the cookie on a document load. The stdio client reads a mode 0600 file and does not print it. A LAN peer gets a cookie only by posting the operator's share token to `/__mathscrap/join`; a short or placeholder token does not turn sharing on. A process on the same machine that forges a document navigation can still receive the cookie, and a same-user process can read the session file.
