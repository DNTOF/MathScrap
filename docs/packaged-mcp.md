# Packaged MCP test build

This is a development build. It is not the signed v0.0.1 release, and it does not replace an installed MathScrap.

The window listens on `127.0.0.1` only. A small `mathscrap-mcp` program speaks MCP on stdio and forwards to that listener. The page tools run in the window. There is no Vite server, no repository working directory, and no Node runtime.

The bearer token is a file in the test profile. It is not printed, not put in a URL, and not stored in the page. The `mcp` directory is created with a protected ACL before the token is written, so a permission inherited from LocalAppData is not copied onto the file. On Windows the current user, SYSTEM, and Administrators can read it. Another local account is not granted access. On Linux the directory is mode 0700 and the files are mode 0600, owned by the current user. A process running as that same user can read the file. This does not block an administrator or SYSTEM. A website cannot: a browser sends `Origin`, and every `Origin` is refused. There is no `Access-Control-Allow-Origin`.

Closing the window deletes the session and endpoint files and closes the listener. `MATHSCRAP_MCP=off` deletes a leftover session and does not listen. If a private ACL cannot be set, or the `mcp` path is a reparse point that cannot be replaced without following it, MCP stays off and the new token is not written. The stdio helper refuses a session or endpoint that is a reparse point, is owned by someone else, or grants any other account.

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
  "command": "npx.cmd",
  "args": ["--yes", "--package", "C:\\Users\\AllowCache\\AppData\\Local\\MathScrap-mcptest-run\\mathscrap-mcp-stdio-0.0.2-dev.tgz", "mathscrap-mcp-stdio"]
}
```

Start the test window first. `cwd` can be `C:\Users\AllowCache`. No extra env is required. The command has no token in it. `npx` reads the session file and speaks JSON lines; it does not launch `mathscrap-mcp.exe`. In a new ZCode session, `/mcp list` then `/mcp connect mathscrap-test`. A stdio spawn that fails in ZCode is a client failure even when this server is fine. The HTTP fallback below puts the token in the config file. That file stays on the machine. Do not copy the token out of it.

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

会话文件是 `%LOCALAPPDATA%\MathScrap-mcptest\mcp\session`，地址文件是同目录的 `endpoint`。不要把令牌贴到聊天里。先备份 `C:\Users\AllowCache\.zcode\cli\config.json`，再合并 stdio 服务器。先打开测试窗口。`command` 用 `npx.cmd`，`args` 是 `--yes`、`--package`、解压目录里的 `mathscrap-mcp-stdio-0.0.2-dev.tgz`、`mathscrap-mcp-stdio`。`cwd` 可以是 `C:\Users\AllowCache`。这个命令不启动 `mathscrap-mcp.exe`。不要用 `zcode -p`，也不要重启已经打开的对话。

令牌在测试配置目录的文件里，不打印，不进网址，不进页面存储。`mcp` 目录在写入令牌之前就带受保护的 ACL，不会继承 LocalAppData 上其他账户的权限。Windows 上当前用户、SYSTEM 和管理员可以读。其他本地账户没有授权。同一用户的进程可以读这个文件，管理员和 SYSTEM 也可以。浏览器带 `Origin` 的请求会被拒绝，响应里没有 `Access-Control-Allow-Origin`。

关掉窗口会删除 session 和 endpoint，并停止监听。`MATHSCRAP_MCP=off` 会清掉残留的 session，且不监听。如果建不起私有 ACL，或 `mcp` 路径是无法安全替换的重解析点，MCP 保持关闭，新令牌不会写入。stdio 助手拒绝重解析点、属主不是当前用户、或授权了其他账户的 session 与 endpoint。

`initialize` 的 `serverInfo.version` 是 `0.0.2-dev`。已签名的 v0.0.1 没有这个监听。

`tools/list` 返回 `page_read`、`page_add_formula`、`page_update_formula`、`solve_analyze`、`plot_open`、`plot_set_view`、`ink_read`。新窗口的 `page_read` 公式列表为空。`page_add_formula` 的 `{"text":"y = 2"}` 只写这张测试纸，随后的 `page_read` 能读回同一条。`solve_analyze` 的 `{"texts":["y = 2"]}` 返回页面引擎的 `dim` 和 `sections`。关掉窗口后，下一次连接失败。

`page_read`、`ink_read`、`solve_analyze` 不改纸面。`page_add_formula`、`page_update_formula`、`plot_open`、`plot_set_view` 会改。
