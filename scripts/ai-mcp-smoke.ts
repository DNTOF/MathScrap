/**
 * AI client + MCP bridge smoke test. No browser.
 *   npm run smoke:ai
 *
 * Spins up a local OpenAI-compatible / Anthropic endpoint and the same bridge
 * the Vite dev server hosts, then asks the real MCP server to list and call tools.
 */
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { assist, directTransport, testConnection, type AiTransport } from '../src/ai/client.ts'
import { missingConfig, type AiConfig } from '../src/ai/config.ts'
import { emphasizeVectors } from '../src/ai/formulas.ts'
import { normalizePlotInput } from '../src/plot/remoteView.ts'
import { createBridge } from '../mcp/bridge.ts'
import { forwardAi, handleAiProxy, isBlockedHost } from '../mcp/ai-proxy.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const SECRET = 'sk-testsecretvalue-SHOULD-NOT-LEAK'
const OK_KEY = 'sk-ok-DO-NOT-LOG'

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('no port')
      resolve(addr.port)
    })
  })
}

function read(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const hits: string[] = []
const auths: string[] = []

const ai = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0] ?? ''
  hits.push(`${req.method} ${path}`)
  const auth = req.headers.authorization ?? ''
  const apiKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : ''
  if (auth) auths.push(auth)
  if (auth.includes('SHOULD-NOT-LEAK') || apiKey.includes('SHOULD-NOT-LEAK')) {
    json(res, 401, { error: { message: `rejected ${auth || apiKey}` } })
    return
  }
  if (req.method === 'GET' && path === '/v1/models') {
    json(res, 200, { data: [{ id: 'demo-model' }] })
    return
  }
  if (req.method === 'POST' && path === '/v1/messages') {
    json(res, 200, { content: [{ type: 'text', text: 'pong' }] })
    return
  }
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    const body = JSON.parse(await read(req)) as { messages?: { role?: string; content?: string }[] }
    const messages = body.messages ?? []
    const hasTool = messages.some((m) => m.role === 'tool')
    const user = messages.filter((m) => m.role === 'user').map((m) => m.content ?? '').join('\n')
    if (!hasTool && user.includes('JSON回退')) {
      json(res, 200, { choices: [{ message: { content: '{"add":["x = 0"],"analyze":true,"note":"补上 y 轴"}' } }] })
      return
    }
    if (!hasTool) {
      json(res, 200, {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'page_add_formula', arguments: '{"text":"b = (1, 2)"}' } }],
            },
          },
        ],
      })
      return
    }
    json(res, 200, { choices: [{ message: { content: '下一步看这个向量。' } }] })
    return
  }
  res.statusCode = 404
  res.end('missing')
})

function spy() {
  const logs: string[] = []
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const prev = methods.map((name) => [name, console[name]] as const)
  for (const name of methods) {
    console[name] = (...args: unknown[]) => {
      logs.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '))
    }
  }
  return {
    logs,
    restore() {
      for (const [name, fn] of prev) console[name] = fn
    },
  }
}

function cfg(partial: Partial<AiConfig> & Pick<AiConfig, 'provider' | 'baseUrl' | 'model'>): AiConfig {
  return { apiKey: '', ...partial }
}

const port = await listen(ai)
const base = `http://127.0.0.1:${port}`
const logs = spy()

try {
  assert.equal(emphasizeVectors('b = (1, 2)'), '**b** = (1, 2)')
  assert.equal(emphasizeVectors('**b** = (1, 2)'), '**b** = (1, 2)')
  assert.equal(emphasizeVectors('y = x^2 - 2'), 'y = x^2 - 2')
  assert.equal(emphasizeVectors('AB = (3, 4)'), 'AB = (3, 4)')
  assert.equal(emphasizeVectors('y = (x + 1)'), 'y = (x + 1)')
  assert.equal(emphasizeVectors('a = (1, 2), b = (0, 1)'), '**a** = (1, 2), **b** = (0, 1)')

  const bad = normalizePlotInput({})
  assert.equal(bad.ok, false)
  const view = normalizePlotInput({ x: [4, -2], y: [1, 1], camera: { eye: { x: 1, y: 2, z: 3 } } })
  assert.equal(view.ok, false)
  const okView = normalizePlotInput({ x: [4, -2], y: [0, 3], mode: '3', only: ['c1'], fit: 'true' })
  assert.equal(okView.ok, true)
  if (okView.ok) {
    assert.deepEqual(okView.value.x, [-2, 4])
    assert.equal(okView.value.mode, 3)
    assert.deepEqual(okView.value.only, ['c1'])
    assert.equal(okView.value.fit, true)
  }

  assert.match(missingConfig(cfg({ provider: 'openai-compatible', baseUrl: '  ', model: ' ' })) ?? '', /Base URL/)
  assert.equal(missingConfig(cfg({ provider: 'local', baseUrl: base, model: 'demo-model' })), null)
  assert.match(missingConfig(cfg({ provider: 'anthropic', baseUrl: '', model: 'claude' })) ?? '', /API Key/)

  let calls = 0
  const boom: AiTransport = {
    async request() {
      calls += 1
      throw new Error('should not send')
    },
  }
  const t0 = Date.now()
  await assert.rejects(() => testConnection(cfg({ provider: 'openai-compatible', baseUrl: '', model: '' }), boom), /还没填写/)
  await assert.rejects(() => testConnection(cfg({ provider: 'openai-compatible', baseUrl: 'ftp://example.com/v1', model: 'demo-model' }), boom), /http 或 https/)
  assert.equal(calls, 0)
  assert.ok(Date.now() - t0 < 200, 'empty config hung')

  const openai = await testConnection(cfg({ provider: 'openai-compatible', baseUrl: `${base}/v1`, model: 'demo-model', apiKey: OK_KEY }))
  assert.match(openai, /OpenAI 兼容接口/)
  assert.ok(hits.includes('GET /v1/models'))
  assert.ok(auths.includes(`Bearer ${OK_KEY}`))

  await assert.rejects(() => testConnection(cfg({ provider: 'openai-compatible', baseUrl: `${base}/v1`, model: 'missing-model', apiKey: OK_KEY })), /没有「missing-model」/)

  const rejected = await testConnection(cfg({ provider: 'openai-compatible', baseUrl: `${base}/v1`, model: 'demo-model', apiKey: SECRET })).then(
    () => 'unexpected success',
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  )
  assert.equal(rejected, '密钥被拒绝（HTTP 401）')
  assert.ok(!rejected.includes('SHOULD-NOT-LEAK'))

  const local = await testConnection(cfg({ provider: 'local', baseUrl: base, model: 'demo-model' }))
  assert.match(local, /本地模型/)
  assert.ok(hits.includes('GET /v1/models'))

  const anthropic = await testConnection(cfg({ provider: 'anthropic', baseUrl: base, model: 'claude', apiKey: OK_KEY }))
  assert.match(anthropic, /Anthropic/)
  assert.ok(hits.includes('POST /v1/messages'))

  const seen: { name: string; args: Record<string, unknown> }[] = []
  const stepped = await assist({
    config: cfg({ provider: 'openai-compatible', baseUrl: `${base}/v1`, model: 'demo-model', apiKey: OK_KEY }),
    prompt: '帮我推一步',
    formulas: [{ id: 'a', text: 'y = x^2 - 2' }],
    callTool(name, args) {
      seen.push({ name, args })
      return { ok: true }
    },
    transport: directTransport(),
  })
  assert.equal(seen[0]?.name, 'page_add_formula')
  assert.equal(seen[0]?.args.text, 'b = (1, 2)')
  assert.match(stepped.text, /向量/)

  const fallbackSeen: string[] = []
  const fallback = await assist({
    config: cfg({ provider: 'openai-compatible', baseUrl: `${base}/v1`, model: 'demo-model', apiKey: OK_KEY }),
    prompt: 'JSON回退',
    formulas: [{ id: 'a', text: 'y = 1' }],
    callTool(name) {
      fallbackSeen.push(name)
      return { ok: true }
    },
    transport: directTransport(),
  })
  assert.deepEqual(fallbackSeen, ['page_add_formula', 'solve_analyze'])
  assert.match(fallback.text, /y 轴/)

  assert.equal(isBlockedHost('169.254.169.254'), true)
  let forwarded = false
  await assert.rejects(
    () =>
      forwardAi({ url: 'http://169.254.169.254/latest/meta-data/models', method: 'GET' }, async () => {
        forwarded = true
        return new Response('no')
      }),
    /拒绝访问/,
  )
  assert.equal(forwarded, false)

  const proxy = createServer((req, res) => {
    void handleAiProxy(req, res)
  })
  const proxyPort = await listen(proxy)
  const proxied = await fetch(`http://127.0.0.1:${proxyPort}/__mathscrap/ai/forward`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `${base}/v1/models`, method: 'GET', headers: { authorization: `Bearer ${SECRET}` } }),
  })
  assert.equal(proxied.headers.get('x-mathscrap-proxy'), '1')
  assert.equal(proxied.status, 401)
  const proxiedBody = await proxied.text()
  assert.ok(proxiedBody.includes('SHOULD-NOT-LEAK'), 'upstream body may echo a key; the proxy must not be the thing that logs it')
  proxy.close()

  assert.ok(!logs.logs.some((line) => line.includes('SHOULD-NOT-LEAK') || line.includes('DO-NOT-LOG')), `API key leaked to console:\n${logs.logs.join('\n')}`)
} finally {
  logs.restore()
  await new Promise<void>((resolve) => ai.close(() => resolve()))
}

const bridge = createBridge()
const bridgeServer = createServer((req, res) => {
  void bridge.handle(req, res)
})
const bridgePort = await listen(bridgeServer)
const bridgeUrl = `http://127.0.0.1:${bridgePort}`

const offlineAt = Date.now()
const offline = await fetch(`${bridgeUrl}/__mathscrap/bridge/call`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'page_read', arguments: {} }),
})
const offlineBody = (await offline.json()) as { ok: boolean; error?: string }
assert.equal(offlineBody.ok, false)
assert.match(offlineBody.error ?? '', /还没连上/)
assert.ok(Date.now() - offlineAt < 500, 'disconnected tool call hung')

const state = {
  formulas: [{ id: 'c1', text: 'y = x^2 - 2', x: 10, y: 20 }],
  strokes: [{ id: 's1', pts: [0, 0, 0.5, 8, 2, 0.4], createdAt: 5, color: '#2b2118', width: 2, style: 'ink' }],
  view: null as unknown,
}
const stop = new AbortController()
const browser = (async () => {
  while (!stop.signal.aborted) {
    const res = await fetch(`${bridgeUrl}/__mathscrap/bridge/wait`, { signal: stop.signal })
    if (res.status === 204) {
      await new Promise((r) => setTimeout(r, 40))
      continue
    }
    const job = (await res.json()) as { id: string; name: string; arguments: Record<string, unknown> }
    let result: unknown = { error: `unknown ${job.name}` }
    if (job.name === 'page_read') result = { formulas: state.formulas, strokes: state.strokes.length }
    else if (job.name === 'page_add_formula') {
      const card = { id: `c${state.formulas.length + 1}`, text: String(job.arguments.text), x: 0, y: 40 }
      state.formulas.push(card)
      result = card
    } else if (job.name === 'plot_set_view') {
      state.view = job.arguments
      result = { ok: true, view: job.arguments }
    } else if (job.name === 'ink_read') result = { returned: state.strokes.length, strokes: state.strokes }
    else if (job.name === 'solve_analyze') result = { texts: job.arguments.texts }
    await fetch(`${bridgeUrl}/__mathscrap/bridge/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: job.id, ok: true, result }),
      signal: stop.signal,
    })
  }
})().catch((e: unknown) => {
  if (!stop.signal.aborted) throw e
})

const healthDeadline = Date.now() + 2000
let connected = false
while (Date.now() < healthDeadline) {
  const health = (await (await fetch(`${bridgeUrl}/__mathscrap/bridge/health`)).json()) as { browser?: boolean }
  if (health.browser) {
    connected = true
    break
  }
  await new Promise((r) => setTimeout(r, 30))
}
assert.equal(connected, true)

const env: Record<string, string> = { NODE_NO_WARNINGS: '1' }
for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') env[key] = value
env.MATHSCRAP_BRIDGE = bridgeUrl
env.NODE_NO_WARNINGS = '1'

let stderr = ''
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'mcp/server.ts'],
  cwd: root,
  env,
  stderr: 'pipe',
})
transport.stderr?.on('data', (chunk: Buffer) => {
  stderr += chunk.toString()
})
const client = new Client({ name: 'mathscrap-smoke', version: '0.0.0' })

try {
  await client.connect(transport)
  const listed = await client.listTools()
  const names = listed.tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, ['ink_read', 'page_add_formula', 'page_read', 'page_update_formula', 'plot_open', 'plot_set_view', 'solve_analyze'])
  for (const tool of listed.tools) assert.equal(tool.inputSchema.type, 'object')

  const read = await client.callTool({ name: 'page_read', arguments: {} })
  assert.notEqual(read.isError, true, textOf(read))
  const page = JSON.parse(textOf(read)) as { formulas: { text: string }[] }
  assert.equal(page.formulas[0]?.text, 'y = x^2 - 2')

  const added = await client.callTool({ name: 'page_add_formula', arguments: { text: 'y = 0' } })
  assert.notEqual(added.isError, true, textOf(added))
  assert.equal(state.formulas.at(-1)?.text, 'y = 0')

  const plotted = await client.callTool({ name: 'plot_set_view', arguments: { x: [-2, 4], y: [-1, 5], camera: { eye: { x: 1.2, y: 0.4, z: 0.8 } } } })
  assert.notEqual(plotted.isError, true, textOf(plotted))
  const viewArgs = state.view as { x?: number[]; camera?: { eye?: { z?: number } } }
  assert.deepEqual(viewArgs.x, [-2, 4])
  assert.equal(viewArgs.camera?.eye?.z, 0.8)

  const ink = await client.callTool({ name: 'ink_read', arguments: { since: 0 } })
  assert.notEqual(ink.isError, true, textOf(ink))
  const inkBody = JSON.parse(textOf(ink)) as { strokes: { pts: number[] }[] }
  assert.equal(inkBody.strokes[0]?.pts.length, 6)
} catch (e) {
  const detail = stderr.trim()
  throw new Error(`${e instanceof Error ? e.message : String(e)}${detail ? `\nstderr:\n${detail}` : ''}`)
} finally {
  stop.abort()
  await browser
  await client.close().catch(() => undefined)
  await new Promise<void>((resolve) => bridgeServer.close(() => resolve()))
}

function textOf(result: unknown) {
  if (!result || typeof result !== 'object' || !('content' in result)) return ''
  const content = result.content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : '')).join('\n')
}

console.log('ai + mcp smoke ok')
