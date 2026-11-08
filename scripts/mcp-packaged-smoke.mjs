/**
 * Drive a release-mode MathScrap binary over MCP.
 * The sheet lives in a temporary profile. The session token is not printed.
 *
 *   GUI=./src-tauri/target/release/mathscrap-mcp-test \
 *   STDIO=./src-tauri/target/release/mathscrap-mcp \
 *   node scripts/mcp-packaged-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const gui = process.env.GUI
const stdioBin = process.env.STDIO
if (!gui || !stdioBin) {
  console.error('Set GUI and STDIO to the release binaries.')
  process.exit(1)
}

const root = mkdtempSync(path.join(tmpdir(), 'mathscrap-mcp-pack-'))
const mcpDir = path.join(root, 'mcp')
const port = 47323
const leaks = []

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function spawnGui() {
  const env = {
    ...process.env,
    MATHSCRAP_MCP_DIR: mcpDir,
    MATHSCRAP_MCP_PORT: String(port),
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    HOME: path.join(root, 'home'),
    WEBKIT_DISABLE_COMPOSITING_MODE: '1',
    GDK_BACKEND: 'x11',
  }
  delete env.MATHSCRAP_MCP
  const command = 'xvfb-run'
  const args = ['-a', '-s', '-screen 0 1280x800x24', gui]
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  return { child, readOutput: () => output }
}

function stopTree(child) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

function forgetSession() {
  for (const name of ['session', 'endpoint']) {
    try {
      unlinkSync(path.join(mcpDir, name))
    } catch {
      /* the next window publishes a new pair */
    }
  }
}

function http(token, { host, origin, session, method = 'POST', target = '/mcp', body = '', extra = '' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    const chunks = []
    socket.setTimeout(8000)
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('timeout'))
    })
    socket.on('error', reject)
    socket.on('data', (chunk) => chunks.push(chunk))
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const [head, ...rest] = raw.split('\r\n\r\n')
      const status = Number(head.split(' ')[1])
      const headers = {}
      for (const line of head.split('\r\n').slice(1)) {
        const idx = line.indexOf(':')
        if (idx > 0) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim()
      }
      const text = rest.join('\r\n\r\n')
      let json
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      resolve({ status, headers, json, raw })
    })
    const payload = body
    let headers = `${method} ${target} HTTP/1.1\r\nHost: ${host ?? `127.0.0.1:${port}`}\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n`
    if (token) headers += `Authorization: Bearer ${token}\r\n`
    if (session) headers += `Mcp-Session-Id: ${session}\r\n`
    if (origin !== undefined) headers += `Origin: ${origin}\r\n`
    headers += extra
    headers += '\r\n'
    socket.end(headers + payload)
  })
}

function frame(message) {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function readFrames(buffer) {
  const out = []
  let rest = buffer
  while (true) {
    const end = rest.indexOf('\r\n\r\n')
    if (end < 0) break
    const head = rest.slice(0, end)
    const match = head.match(/content-length:\s*(\d+)/i)
    if (!match) break
    const length = Number(match[1])
    const start = end + 4
    if (rest.length < start + length) break
    out.push(JSON.parse(rest.slice(start, start + length)))
    rest = rest.slice(start + length)
  }
  return { messages: out, rest }
}

async function waitForSession() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const token = readFileSync(path.join(mcpDir, 'session'), 'utf8').trim()
      const endpoint = readFileSync(path.join(mcpDir, 'endpoint'), 'utf8').trim()
      if (token.length === 64 && endpoint === `http://127.0.0.1:${port}/mcp`) return token
    } catch {
      /* the window is still starting */
    }
    await delay(200)
  }
  throw new Error('the packaged window did not publish a loopback session')
}

const guiProc = spawnGui()
let token = ''
let extra
let stdioChild
try {
  token = await waitForSession()
  const output = guiProc.readOutput()
  assert(!output.includes(token), 'the window printed the session token')

  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'packaged-smoke', version: '0' } },
  })
  const denied = await http(null, { body: initBody })
  assert(denied.status === 401, `missing token status ${denied.status}`)
  const foreign = await http(token, { origin: 'null', body: initBody })
  assert(foreign.status === 403, `null origin status ${foreign.status}`)
  const rebound = await http(token, { host: 'evil.example:47323', body: initBody })
  assert(rebound.status === 403, `rebound host status ${rebound.status}`)
  assert(!denied.raw.includes('access-control-allow-origin') && !foreign.raw.includes('location:'), 'cors or redirect header')

  const opened = await http(token, { body: initBody })
  assert(opened.status === 200, `initialize ${opened.status}`)
  const session = opened.headers['mcp-session-id']
  assert(session && session !== token, 'session id missing or equal to the bearer token')
  const note = await http(token, { session, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  assert(note.status === 202, `notification ${note.status}`)
  const listed = await http(token, { session, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })
  const names = listed.json.result.tools.map((tool) => tool.name)
  assert(names.join() === 'page_read,page_add_formula,page_update_formula,solve_analyze,plot_open,plot_set_view,ink_read', names.join())

  async function call(id, name, args) {
    const deadline = Date.now() + 20_000
    let last
    while (Date.now() < deadline) {
      last = await http(token, {
        session,
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      })
      const text = last.json?.result?.content?.[0]?.text ?? ''
      if (!text.includes('mcp_page_offline')) return last
      await delay(250)
    }
    return last
  }

  const blank = await call(3, 'page_read', {})
  assert(blank.json.result.isError !== true, `blank read ${blank.json?.result?.content?.[0]?.text}`)
  const blankBody = JSON.parse(blank.json.result.content[0].text)
  assert(Array.isArray(blankBody.formulas) && blankBody.formulas.length === 0, 'the temporary sheet was not empty')

  const added = await call(4, 'page_add_formula', { text: 'y = x' })
  assert(added.json.result.isError !== true, added.json?.result?.content?.[0]?.text)
  const card = JSON.parse(added.json.result.content[0].text)
  assert(card.text === 'y = x' && card.id, 'add did not return the new formula')

  const updated = await call(5, 'page_update_formula', { id: card.id, text: 'y = 2' })
  assert(updated.json.result.isError !== true, updated.json?.result?.content?.[0]?.text)

  const read = await call(6, 'page_read', {})
  const formulas = JSON.parse(read.json.result.content[0].text).formulas
  assert(
    formulas.length === 1 && formulas[0].text === 'y = 2' && formulas[0].id === card.id,
    `the sheet did not keep the edit ${JSON.stringify(formulas)}`,
  )

  const solved = await call(7, 'solve_analyze', { texts: ['y = 2'] })
  assert(solved.json.result.isError !== true, solved.json?.result?.content?.[0]?.text)
  const analysis = JSON.parse(solved.json.result.content[0].text)
  assert(analysis.dim === 2 && Array.isArray(analysis.sections), 'solve_analyze did not come back from the page engine')

  const child = spawn(stdioBin, [], {
    env: { ...process.env, MATHSCRAP_MCP_DIR: mcpDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  stdioChild = child
  let incoming = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    incoming += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }))
  child.stdin.write(frame({ jsonrpc: '2.0', method: 'notifications/initialized' }))
  child.stdin.write(frame({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'page_read', arguments: {} } }))
  const stdioDeadline = Date.now() + 15_000
  let parsed = []
  while (Date.now() < stdioDeadline && parsed.length < 2) {
    await delay(100)
    parsed = readFrames(incoming).messages
  }
  child.kill()
  assert(!stderr.includes(token) && !parsed.some((message) => JSON.stringify(message).includes(token)), 'stdio printed the token')
  const tool = parsed.find((message) => message.id === 2)
  assert(tool && tool.result.isError !== true, `stdio page_read failed ${JSON.stringify(parsed)}`)
  const viaStdio = JSON.parse(tool.result.content[0].text)
  assert(viaStdio.formulas[0].text === 'y = 2', 'stdio did not read the packaged sheet')

  await new Promise((resolve) => {
    guiProc.child.once('exit', resolve)
    stopTree(guiProc.child)
  })
  forgetSession()
  let closed = false
  try {
    await http(token, { body: initBody })
  } catch {
    closed = true
  }
  assert(closed, 'the listener stayed up after the window exited')

  const again = spawnGui()
  extra = again
  const nextToken = await waitForSession()
  assert(nextToken !== token, 'restart reused the bearer token')
  const stale = await http(token, { body: initBody })
  assert(stale.status === 401, 'the old token still worked')
  const fresh = await http(nextToken, { body: initBody })
  assert(fresh.status === 200 && fresh.json.result.serverInfo.version === '0.0.2-dev', JSON.stringify(fresh.json))
  stopTree(again.child)
  console.log('mcp packaged smoke ok')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  const shown = token ? guiProc.readOutput().replaceAll(token, '[token]') : guiProc.readOutput()
  console.error(shown.slice(-2000))
  process.exitCode = 1
} finally {
  stopTree(guiProc.child)
  stopTree(extra?.child)
  try {
    stdioChild?.kill()
  } catch {
    /* already gone */
  }
  rmSync(root, { recursive: true, force: true })
  if (leaks.length) process.exitCode = 1
  process.exit(process.exitCode ?? 0)
}
