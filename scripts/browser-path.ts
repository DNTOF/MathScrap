/**
 * Find a Chrome/Chromium/Edge binary for the sheet and plot end-to-end scripts.
 *
 * Order:
 * 1. CHROME_PATH, if set. A missing file is an error, not a silent fallback.
 * 2. A Chromium already installed under PLAYWRIGHT_BROWSERS_PATH, or the
 *    default Playwright cache when that variable is unset.
 * 3. google-chrome, chromium, or Edge on PATH.
 * 4. The usual install locations on Linux, macOS, and Windows.
 */
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export interface ResolvedBrowser {
  executablePath: string
  via: string
}

function canRun(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function which(name: string): string | null {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
    const found = out.split(/\r?\n/).map((line) => line.trim()).find((line) => line && canRun(line))
    return found ?? null
  } catch {
    return null
  }
}

function chromiumUnder(root: string): string | null {
  if (!root || !existsSync(root)) return null
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return null
  }
  const hits: string[] = []
  for (const name of names) {
    if (!name.startsWith('chromium')) continue
    const base = join(root, name)
    const guesses = [
      join(base, 'chrome-linux64', 'chrome'),
      join(base, 'chrome-linux', 'chrome'),
      join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(base, 'chrome-win64', 'chrome.exe'),
      join(base, 'chrome-win', 'chrome.exe'),
    ]
    for (const guess of guesses) if (canRun(guess)) hits.push(guess)
  }
  hits.sort()
  return hits.at(-1) ?? null
}

function playwrightRoots(): { via: string; root: string }[] {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (env && env !== '0') return [{ via: 'PLAYWRIGHT_BROWSERS_PATH', root: env }]
  if (env === '0') return [{ via: 'PLAYWRIGHT_BROWSERS_PATH=0', root: join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers') }]
  return [
    { via: 'playwright cache', root: join(homedir(), '.cache', 'ms-playwright') },
    { via: 'playwright cache (macOS)', root: join(homedir(), 'Library', 'Caches', 'ms-playwright') },
    { via: 'playwright cache (Windows)', root: join(process.env.LOCALAPPDATA ?? '', 'ms-playwright') },
  ]
}

function knownPaths(): { via: string; path: string }[] {
  const pf = process.env.PROGRAMFILES ?? 'C:\\Program Files'
  const pf86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA ?? ''
  return [
    { via: 'Linux Chrome', path: '/usr/bin/google-chrome' },
    { via: 'Linux Chrome stable', path: '/usr/bin/google-chrome-stable' },
    { via: 'Linux Chromium', path: '/usr/bin/chromium' },
    { via: 'Linux Chromium browser', path: '/usr/bin/chromium-browser' },
    { via: '/usr/local Chrome', path: '/usr/local/bin/google-chrome' },
    { via: '/usr/local Chromium', path: '/usr/local/bin/chromium' },
    { via: 'macOS Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { via: 'macOS Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
    { via: 'macOS Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    { via: 'Windows Chrome', path: join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { via: 'Windows Chrome (x86)', path: join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { via: 'Windows Edge', path: join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { via: 'Windows Chromium', path: join(local, 'Chromium', 'Application', 'chrome.exe') },
  ]
}

const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge', 'chrome']

export function resolveBrowser(): ResolvedBrowser {
  const override = process.env.CHROME_PATH?.trim()
  if (override) {
    if (!canRun(override)) throw new Error(`CHROME_PATH is set but is not an executable file: ${override}`)
    return { executablePath: override, via: 'CHROME_PATH' }
  }
  for (const root of playwrightRoots()) {
    const found = chromiumUnder(root.root)
    if (found) return { executablePath: found, via: root.via }
  }
  for (const name of PATH_NAMES) {
    const found = which(name)
    if (found) return { executablePath: found, via: `PATH ${name}` }
  }
  for (const item of knownPaths()) {
    if (canRun(item.path)) return { executablePath: item.path, via: item.via }
  }
  throw new Error(
    `No Chrome, Chromium, or Edge binary found. Set CHROME_PATH, install Chrome on PATH, or set PLAYWRIGHT_BROWSERS_PATH to a Playwright browser directory. PATH=${process.env.PATH?.split(delimiter).slice(0, 8).join(delimiter) ?? ''}`,
  )
}
