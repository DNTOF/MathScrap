# Packaged MCP test build

This is a development build. It is not the signed v0.0.1 release, and it does not replace an installed MathScrap.

The window listens on `127.0.0.1` only. A small `mathscrap-mcp` program speaks MCP on stdio and forwards to that listener. The page tools run in the window. There is no Vite server, no repository working directory, and no Node runtime.

The bearer token is a file in the test profile. It is not printed, not put in a URL, and not stored in the page. A process running as the same OS user can read the file. Another user, and a machine on the network, cannot. A website cannot: a browser sends `Origin`, and every `Origin` is refused. There is no `Access-Control-Allow-Origin`.

Closing the window closes the listener. `MATHSCRAP_MCP=off` starts the window without one.

## What the parent runs

The CI artifact `mathscrap-mcp-test-windows` is an unsigned pair of EXEs plus `SHA256SUMS` and `PROVENANCE.txt`. It is a workflow artifact, not a GitHub Release. Check the hashes on the laptop before running anything. Do not install a trust root, and do not turn signature checking off. Windows will say the publisher is unknown.

Unzip it into a new folder, for example `C:\Users\AllowCache\AppData\Local\MathScrap-mcptest-run\`. Leave `C:\Users\AllowCache\AppData\Local\MathScrap\mathscrap.exe` where it is. The test identifier is `app.mathscrap.mcptest`, so its notes are not the installed app's notes. The sheet starts empty.

Start `MathScrap-mcp-test-windows-x64.exe`. The window title is MathScrap MCP Test. It writes:

```
%LOCALAPPDATA%\MathScrap-mcptest\mcp\session
%LOCALAPPDATA%\MathScrap-mcptest\mcp\endpoint
```

`endpoint` is `http://127.0.0.1:47323/mcp`. `session` is the token. Do not paste the token into chat.

Back up `C:\Users\AllowCache\.zcode\cli\config.json` and merge one server. Do not use `zcode -p`, and do not restart the chat that is already open.

```json
"mathscrap-test": {
  "type": "stdio",
  "command": "C:\\Users\\AllowCache\\AppData\\Local\\MathScrap-mcptest-run\\mathscrap-mcp.exe"
}
```

The command has no token in it. The program reads the session file. In a new ZCode session, `/mcp list` then `/mcp connect mathscrap-test`. A stdio spawn that fails in ZCode is a client failure even when this server is fine. The HTTP fallback below puts the token in the config file. That file stays on the machine. Do not copy the token out of it.

```json
"mathscrap-test-http": {
  "type": "http",
  "url": "http://127.0.0.1:47323/mcp",
  "headers": {
    "Authorization": "Bearer <contents of the session file>"
  }
}
```

Replace the angle-bracket text with the session file. Do not send that value anywhere else.

`initialize` returns `serverInfo.name` `mathscrap` and `serverInfo.version` `0.0.2-dev`. The signed v0.0.1 app has no listener.

`tools/list` returns `page_read`, `page_add_formula`, `page_update_formula`, `solve_analyze`, `plot_open`, `plot_set_view`, and `ink_read`. `page_read` on a new test window returns an empty formula list. `page_add_formula` with `{"text":"y = 2"}` writes only that test sheet. A following `page_read` returns that same formula. `solve_analyze` with `{"texts":["y = 2"]}` returns the page engine's `dim` and `sections`. Closing the window makes the next call fail to connect.

`page_read`, `ink_read`, and `solve_analyze` do not change the sheet. `page_add_formula`, `page_update_formula`, `plot_open`, and `plot_set_view` do.

# 打包后的 MCP 测试构建

这是开发构建，不是已签名的 v0.0.1，也不会替换已经装上的 MathScrap。不要动 `C:\Users\AllowCache\AppData\Local\MathScrap\mathscrap.exe`。把测试程序解到新目录，例如 `C:\Users\AllowCache\AppData\Local\MathScrap-mcptest-run\`。窗口标题是 MathScrap MCP Test。窗口只听 `127.0.0.1`。`mathscrap-mcp` 用 stdio 转发，命令行里没有令牌。工具在窗口里执行。不需要 Vite、仓库目录或 Node。

会话文件是 `%LOCALAPPDATA%\MathScrap-mcptest\mcp\session`，地址文件是同目录的 `endpoint`。不要把令牌贴到聊天里。先备份 `C:\Users\AllowCache\.zcode\cli\config.json`，再合并 stdio 服务器，命令用 `mathscrap-mcp.exe` 的完整路径。不要用 `zcode -p`，也不要重启已经打开的对话。

令牌在测试配置目录的文件里，不打印，不进网址，不进页面存储。同一系统用户的进程可以读这个文件。其他用户和局域网不行。浏览器带 `Origin` 的请求会被拒绝，响应里没有 `Access-Control-Allow-Origin`。

关掉窗口，监听就停。`MATHSCRAP_MCP=off` 时窗口仍在，但不监听。

`initialize` 的 `serverInfo.version` 是 `0.0.2-dev`。已签名的 v0.0.1 没有这个监听。

`tools/list` 返回 `page_read`、`page_add_formula`、`page_update_formula`、`solve_analyze`、`plot_open`、`plot_set_view`、`ink_read`。新窗口的 `page_read` 公式列表为空。`page_add_formula` 的 `{"text":"y = 2"}` 只写这张测试纸，随后的 `page_read` 能读回同一条。`solve_analyze` 的 `{"texts":["y = 2"]}` 返回页面引擎的 `dim` 和 `sections`。关掉窗口后，下一次连接失败。

`page_read`、`ink_read`、`solve_analyze` 不改纸面。`page_add_formula`、`page_update_formula`、`plot_open`、`plot_set_view` 会改。
