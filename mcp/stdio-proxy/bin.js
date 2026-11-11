#!/usr/bin/env node
/**
 * Standard MCP stdio for a running MathScrap window.
 * One JSON-RPC object per line. The bearer token is read from the session
 * file and is not written to stdout or stderr. This does not start the
 * window and it does not spawn mathscrap-mcp.exe.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import readline from 'node:readline'

const CLOSED = 'MathScrap is not running.'
const REPARSE = 'The session path is a reparse point.'
const ENDPOINT = 'The endpoint is not loopback HTTP.'

function sessionDir() {
  const override = process.env.MATHSCRAP_MCP_DIR
  if (override && override.trim()) return override
  const base = process.env.LOCALAPPDATA
  if (base) return path.join(base, 'MathScrap-mcptest', 'mcp')
  const home = process.env.HOME || process.env.USERPROFILE || ''
  return path.join(home, '.local', 'share', 'MathScrap-mcptest', 'mcp')
}

function plainFile(file) {
  let info
  try {
    info = fs.lstatSync(file)
  } catch {
    const error = new Error(CLOSED)
    error.codeName = 'mcp_closed'
    throw error
  }
  if (info.isSymbolicLink()) {
    const error = new Error(REPARSE)
    error.codeName = 'mcp_secret_reparse'
    throw error
  }
}

function loadSession() {
  const dir = sessionDir()
  plainFile(dir)
  const endpointFile = path.join(dir, 'endpoint')
  const sessionFile = path.join(dir, 'session')
  plainFile(endpointFile)
  plainFile(sessionFile)
  const endpoint = fs.readFileSync(endpointFile, 'utf8').trim()
  const token = fs.readFileSync(sessionFile, 'utf8').trim()
  let url
  try {
    url = new URL(endpoint)
  } catch {
    const error = new Error(ENDPOINT)
    error.codeName = 'mcp_closed'
    throw error
  }
  const host = url.hostname.toLowerCase()
  const port = Number(url.port)
  if (url.protocol !== 'http:' || url.pathname !== '/mcp' || !port || (host !== '127.0.0.1' && host !== 'localhost')) {
    const error = new Error(ENDPOINT)
    error.codeName = 'mcp_closed'
    throw error
  }
  if (!/^[0-9a-fA-F]{64}$/.test(token)) {
    const error = new Error(CLOSED)
    error.codeName = 'mcp_closed'
    throw error
  }
  return { port, token }
}

function post(port, token, sessionId, body) {
  const payload = Buffer.from(body)
  return new Promise((resolve, reject) => {
    const headers = {
      Host: `127.0.0.1:${port}`,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': String(payload.length),
      Connection: 'close',
    }
    if (sessionId) headers['Mcp-Session-Id'] = sessionId
    const req = http.request(
      { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size <= 1024 * 1024) chunks.push(chunk)
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            session: typeof res.headers['mcp-session-id'] === 'string' ? res.headers['mcp-session-id'] : '',
            body: Buffer.concat(chunks),
          })
        })
      },
    )
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(payload)
  })
}

function writeLine(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function fail(id, codeName, message) {
  if (id === undefined) return
  writeLine({ jsonrpc: '2.0', id, error: { code: -32001, message, data: { code: codeName } } })
}

let sessionId = ''

async function handle(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    fail(null, 'mcp_bad_json', 'The body is not JSON.')
    return
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    fail(null, 'mcp_bad_json', 'The body is not JSON.')
    return
  }
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : undefined
  if (message.method === 'initialize') sessionId = ''
  let loaded
  try {
    loaded = loadSession()
  } catch (error) {
    fail(id, error.codeName || 'mcp_closed', error.message || CLOSED)
    return
  }
  let response
  try {
    response = await post(loaded.port, loaded.token, sessionId, JSON.stringify(message))
  } catch {
    fail(id, 'mcp_closed', CLOSED)
    return
  }
  if (response.session) sessionId = response.session
  if (id === undefined || id === null) return
  if (response.status >= 300 && response.status < 400) {
    fail(id, 'mcp_closed', CLOSED)
    return
  }
  if (!response.body.length) {
    if (response.status !== 202) fail(id, 'mcp_closed', CLOSED)
    return
  }
  process.stdout.write(response.body)
  if (response.body[response.body.length - 1] !== 0x0a) process.stdout.write('\n')
}

const pending = []
let busy = false

async function drain() {
  if (busy) return
  busy = true
  try {
    while (pending.length) {
      await handle(pending.shift())
    }
  } catch {
    process.stderr.write('MathScrap MCP stdio failed.\n')
    process.exit(1)
  } finally {
    busy = false
    if (pending.length) void drain()
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  if (!line.trim()) return
  pending.push(line)
  void drain()
})
