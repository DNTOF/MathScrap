/**
 * Speak newline-delimited MCP to a stdio command.
 * Drains stdout and stderr, stops at a deadline, and prints counts plus a
 * redacted snippet. It does not print a bearer token.
 *
 *   node scripts/mcp-stdio-probe.mjs npx --yes --package ./mathscrap-mcp-stdio-0.0.2-dev.tgz mathscrap-mcp-stdio
 */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const CAP = 65536
const HEX = /[0-9a-fA-F]{32,}/g

export function redact(text) {
  return String(text).replace(HEX, '[redacted]')
}

function summarize(stdout) {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  let initialize = 'missing'
  let tools = 'missing'
  let page = 'missing'
  for (const line of lines) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.id === 1 && message.result?.serverInfo) {
      initialize = `ok name=${message.result.serverInfo.name} version=${message.result.serverInfo.version}`
    } else if (message.id === 1) {
      initialize = 'error'
    }
    if (message.id === 2 && Array.isArray(message.result?.tools)) {
      const names = message.result.tools.map((tool) => tool.name)
      tools = names.includes('page_read') ? `ok ${names.length}` : `missing-page_read ${names.length}`
    } else if (message.id === 2) {
      tools = 'error'
    }
    if (typeof message.id === 'number' && message.id >= 3) {
      const text = message.result?.content?.[0]?.text ?? ''
      if (message.result?.isError === true || text.includes('mcp_page_offline')) {
        page = 'offline'
        continue
      }
      try {
        const body = JSON.parse(text)
        page = Array.isArray(body.formulas) ? `ok formulas=${body.formulas.length}` : 'not-a-sheet'
      } catch {
        page = 'not-json'
      }
    }
  }
  if (!stdout) initialize = initialize === 'missing' ? 'zero-stdout' : initialize
  else if (!stdout.includes('\n') && initialize === 'missing') initialize = 'partial-no-newline'
  return { initialize, tools, page }
}

export async function probeChild(child, timeoutMs) {
  let stdout = Buffer.alloc(0)
  let stderr = Buffer.alloc(0)
  child.stdout?.on('data', (chunk) => {
    if (stdout.length < CAP) stdout = Buffer.concat([stdout, chunk]).subarray(0, CAP)
  })
  child.stderr?.on('data', (chunk) => {
    if (stderr.length < CAP) stderr = Buffer.concat([stderr, chunk]).subarray(0, CAP)
  })
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stdio-probe', version: '0' } },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  let pageId = 3
  send({ jsonrpc: '2.0', id: pageId, method: 'tools/call', params: { name: 'page_read', arguments: {} } })
  const deadline = Date.now() + timeoutMs
  let pageSent = Date.now()
  let report = summarize('')
  while (Date.now() < deadline) {
    report = summarize(stdout.toString('utf8'))
    if (report.initialize.startsWith('ok') && report.tools.startsWith('ok') && report.page.startsWith('ok')) break
    if (report.page === 'offline' && Date.now() - pageSent > 300 && pageId < 12) {
      pageId += 1
      pageSent = Date.now()
      send({ jsonrpc: '2.0', id: pageId, method: 'tools/call', params: { name: 'page_read', arguments: {} } })
    }
    if (child.exitCode !== null && report.initialize !== 'missing') break
    await delay(50)
  }
  const poll = child.exitCode
  child.stdin.end()
  const stopAt = Date.now() + 5_000
  while (child.exitCode === null && Date.now() < stopAt) await delay(50)
  if (child.exitCode === null) child.kill()
  await delay(100)
  const outText = stdout.toString('utf8')
  const errText = stderr.toString('utf8')
  const leaked = HEX.test(outText)
  HEX.lastIndex = 0
  return {
    ok: !leaked && report.initialize.startsWith('ok') && report.tools.startsWith('ok') && report.page.startsWith('ok'),
    poll,
    returncode: child.exitCode,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    ...report,
    leaked,
    stdoutRedacted: redact(outText).slice(0, 180).replaceAll('\n', '\\n'),
    stderrRedacted: redact(errText).slice(0, 180).replaceAll('\n', '\\n'),
  }
}

export function printProbe(result) {
  console.log(`stdout_bytes=${result.stdoutBytes}`)
  console.log(`stderr_bytes=${result.stderrBytes}`)
  console.log(`poll_before_close=${result.poll}`)
  console.log(`returncode=${result.returncode}`)
  console.log(`initialize=${result.initialize}`)
  console.log(`tools=${result.tools}`)
  console.log(`page_read=${result.page}`)
  console.log(`stdout_redacted=${result.stdoutRedacted}`)
  console.log(`stderr_redacted=${result.stderrRedacted}`)
}

async function main() {
  const command = process.argv[2]
  if (!command) {
    console.error('usage: node scripts/mcp-stdio-probe.mjs <command> [args...]')
    process.exit(2)
  }
  const child = spawn(command, process.argv.slice(3), {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  const result = await probeChild(child, 30_000)
  printProbe(result)
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] && process.argv[1].endsWith('mcp-stdio-probe.mjs')) main()
