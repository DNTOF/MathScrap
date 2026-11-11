/**
 * Start the packaged MathScrap test window and speak MCP through npx.
 * This is the Windows handshake. It drains both pipes and does not print the token.
 *
 *   GUI=src-tauri/target/release/mathscrap-mcp-test.exe \
 *   TGZ=packaging/out/mathscrap-mcp-stdio-0.0.2-dev.tgz \
 *   node scripts/mcp-windows-npx-smoke.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { printProbe, probeChild } from './mcp-stdio-probe.mjs'

const gui = process.env.GUI
const tgz = process.env.TGZ
if (!gui || !tgz) {
  console.error('Set GUI and TGZ.')
  process.exit(1)
}

const root = mkdtempSync(path.join(tmpdir(), 'mathscrap-npx-'))
const mcpDir = path.join(root, 'mcp')
let guiProc
let port = 0

function stopGui() {
  if (!guiProc?.pid || guiProc.exitCode !== null) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(guiProc.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(guiProc.pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

async function waitForSession() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const token = readFileSync(path.join(mcpDir, 'session'), 'utf8').trim()
      const endpoint = readFileSync(path.join(mcpDir, 'endpoint'), 'utf8').trim()
      const match = endpoint.match(/^http:\/\/127\.0\.0\.1:(\d+)\/mcp$/)
      if (token.length === 64 && match) {
        port = Number(match[1])
        return
      }
    } catch {
      /* the window is still starting */
    }
    await delay(200)
  }
  throw new Error('the packaged window did not publish a loopback session')
}

function closeMainWindow(pid) {
  const script = [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if (-not $p) { Write-Output exited; exit 0 }',
    '$ok = $false',
    'try { $ok = $p.CloseMainWindow() } catch { $ok = $false }',
    "if (-not $ok) { Write-Output 'no-window'; exit 2 }",
    'if (-not $p.WaitForExit(20000)) { Write-Output \'still-running\'; exit 3 }',
    'Write-Output exited',
  ].join('\n')
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
}

function filesRemain() {
  for (const name of ['session', 'endpoint']) {
    try {
      readFileSync(path.join(mcpDir, name))
      return true
    } catch {
      /* removed */
    }
  }
  return false
}

function listenerOpen() {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.setTimeout(500)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

try {
  guiProc = spawn(gui, [], {
    env: { ...process.env, MATHSCRAP_MCP_DIR: mcpDir, MATHSCRAP_MCP_PORT: '0' },
    stdio: 'ignore',
    windowsHide: false,
  })
  await waitForSession()
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const child = spawn(npx, ['--yes', '--package', tgz, 'mathscrap-mcp-stdio'], {
    env: {
      ...process.env,
      MATHSCRAP_MCP_DIR: mcpDir,
      NPM_CONFIG_LOGLEVEL: 'silent',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  const result = await probeChild(child, 45_000)
  printProbe(result)
  if (!result.ok) process.exitCode = 1
  else if (process.platform === 'win32') {
    const closed = closeMainWindow(guiProc.pid)
    console.log(`close=${closed}`)
    if (closed !== 'exited' || filesRemain() || (await listenerOpen())) {
      console.error('normal close left the session or the listener')
      process.exitCode = 1
    }
  }
} catch (error) {
  console.error(String(error.message || error).replace(/[0-9a-fA-F]{32,}/g, '[redacted]'))
  process.exitCode = 1
} finally {
  stopGui()
  rmSync(root, { recursive: true, force: true })
}
