/**
 * Decide whether a diff needs the full test job or a version check.
 * Unknown, renamed, deleted, added, or unreadable changes are full.
 * A broken baseline fails the process instead of passing.
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const LOCAL_CRATES = new Set(['mathscrap', 'mathcore'])

const VERSION_FILES = new Set([
  'package.json',
  'package-lock.json',
  'src/version.ts',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'crates/mathcore/Cargo.toml',
  'crates/mathcore/Cargo.lock',
  'src/wasm/pkg/package.json',
  'mcp/server.ts',
])

export function isDocsPath(path) {
  return path === 'README.md' || path.startsWith('docs/') || path.startsWith('signing/') && path.endsWith('.md')
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]))
  }
  return value
}

function jsonEqual(left, right) {
  return JSON.stringify(canon(left)) === JSON.stringify(canon(right))
}

function jsonVersionOnly(oldText, newText) {
  let oldJson
  let newJson
  try {
    oldJson = JSON.parse(oldText)
    newJson = JSON.parse(newText)
  } catch {
    return false
  }
  if (!oldJson || typeof oldJson !== 'object' || !newJson || typeof newJson !== 'object') return false
  oldJson.version = '0.0.0'
  newJson.version = '0.0.0'
  return jsonEqual(oldJson, newJson)
}

function lockVersionOnly(oldText, newText) {
  let oldJson
  let newJson
  try {
    oldJson = JSON.parse(oldText)
    newJson = JSON.parse(newText)
  } catch {
    return false
  }
  const rewind = (value) => {
    const copy = JSON.parse(JSON.stringify(value))
    if (Object.prototype.hasOwnProperty.call(copy, 'version')) copy.version = '0.0.0'
    if (copy.packages && copy.packages[''] && Object.prototype.hasOwnProperty.call(copy.packages[''], 'version')) {
      copy.packages[''].version = '0.0.0'
    }
    return copy
  }
  return jsonEqual(rewind(oldJson), rewind(newJson))
}

function cargoManifestVersionOnly(oldText, newText) {
  const norm = (text) => {
    let inPackage = false
    let replaced = false
    return text.split('\n').map((line) => {
      if (/^\[/.test(line)) inPackage = line.trim() === '[package]'
      if (inPackage && !replaced && /^version\s*=\s*"/.test(line)) {
        replaced = true
        return 'version = "0.0.0"'
      }
      return line
    }).join('\n')
  }
  return norm(oldText) === norm(newText)
}

function cargoLockVersionOnly(oldText, newText) {
  const norm = (text) => text.split('\n[[package]]\n').map((block, index) => {
    const body = index === 0 ? block : `[[package]]\n${block}`
    const name = body.match(/^name = "([^"]+)"/m)
    if (!name || !LOCAL_CRATES.has(name[1])) return body
    return body.replace(/^version = "[^"]*"/m, 'version = "0.0.0"')
  }).join('\n')
  return norm(oldText) === norm(newText)
}

function literalVersionOnly(oldText, newText, pattern) {
  const mask = (text) => text.replace(pattern, '$10.0.0$2')
  return mask(oldText) === mask(newText)
}

export function versionFieldOnly(path, oldText, newText) {
  if (oldText == null || newText == null) return false
  if (oldText.includes('\0') || newText.includes('\0')) return false
  if (path === 'package-lock.json') return lockVersionOnly(oldText, newText)
  if (path === 'package.json' || path === 'src-tauri/tauri.conf.json' || path === 'src/wasm/pkg/package.json') {
    return jsonVersionOnly(oldText, newText)
  }
  if (path.endsWith('Cargo.toml')) return cargoManifestVersionOnly(oldText, newText)
  if (path.endsWith('Cargo.lock')) return cargoLockVersionOnly(oldText, newText)
  if (path === 'src/version.ts') return literalVersionOnly(oldText, newText, /(export const APP_VERSION = ')[^']*(')/)
  if (path === 'mcp/server.ts') return literalVersionOnly(oldText, newText, /(name: 'mathscrap', version: ')[^']*(')/)
  return false
}

export function classifyEntries(entries) {
  if (!Array.isArray(entries)) {
    return { mode: 'full', reasonZh: '分类输入无法读取，改走全量。', reasonEn: 'The classifier input could not be read, so the full test runs.' }
  }
  if (entries.length === 0) {
    return { mode: 'light', reasonZh: '基线之间没有文件变化。', reasonEn: 'There are no file changes between the baselines.' }
  }
  const notes = []
  for (const entry of entries) {
    const status = entry.status || ''
    if (status.startsWith('R') || status.startsWith('C') || status === 'T') {
      notes.push(`${entry.path || entry.oldPath} 被重命名或改变类型`)
      continue
    }
    if (status === 'D' || status === 'A') {
      notes.push(`${entry.path} 被${status === 'D' ? '删除' : '新增'}`)
      continue
    }
    if (status !== 'M' || entry.oldMode !== entry.newMode) {
      notes.push(`${entry.path || '(unknown)'} 无法按字段识别`)
      continue
    }
    if (isDocsPath(entry.path)) {
      if ((entry.oldText || '').includes('\0') || (entry.newText || '').includes('\0')) {
        notes.push(`${entry.path} 无法按文档文本识别`)
        continue
      }
      notes.push(`${entry.path} 只是文档`)
      continue
    }
    if (VERSION_FILES.has(entry.path) && versionFieldOnly(entry.path, entry.oldText, entry.newText)) {
      notes.push(`${entry.path} 只有版本字段变化`)
      continue
    }
    notes.push(`${entry.path} 含有版本字段以外的变化`)
  }
  const heavy = notes.filter((note) => !note.endsWith('只是文档') && !note.endsWith('只有版本字段变化'))
  if (heavy.length) {
    return {
      mode: 'full',
      reasonZh: `这些变化需要全量测试：${heavy.join('；')}。`,
      reasonEn: `These changes need the full test: ${heavy.join('; ')}.`,
    }
  }
  return {
    mode: 'light',
    reasonZh: `变化都在文档或版本字段白名单内：${notes.join('；')}。`,
    reasonEn: `Every change is documentation or a whitelisted version field: ${notes.join('; ')}.`,
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function gitOk(cwd, args) {
  try {
    git(cwd, args)
    return true
  } catch {
    return false
  }
}

export function assertBaseline(cwd, base, head) {
  if (!base || !head || /^0+$/.test(base)) {
    throw new Error('The diff baseline is missing.')
  }
  if (!gitOk(cwd, ['cat-file', '-e', `${base}^{commit}`]) || !gitOk(cwd, ['cat-file', '-e', `${head}^{commit}`])) {
    throw new Error('The diff baseline is not in this clone.')
  }
  let mergeBase
  try {
    mergeBase = git(cwd, ['merge-base', base, head]).trim()
  } catch {
    throw new Error('git merge-base failed.')
  }
  return mergeBase
}

function readAt(cwd, rev, path) {
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], { cwd, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

export function entriesFromGit(cwd, base, head) {
  const mergeBase = assertBaseline(cwd, base, head)
  let raw
  try {
    raw = git(cwd, ['diff', '--raw', '-M', mergeBase, head])
  } catch {
    throw new Error('git diff failed.')
  }
  const entries = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) throw new Error('git diff output could not be parsed.')
    const meta = line.slice(0, tab).split(' ')
    const paths = line.slice(tab + 1).split('\t')
    const status = meta[4]
    const oldMode = meta[0].replace(/^:/, '')
    const newMode = meta[1]
    if (status.startsWith('R') || status.startsWith('C')) {
      entries.push({ status, oldMode, newMode, oldPath: paths[0], path: paths[1], oldText: null, newText: null })
      continue
    }
    const path = paths[0]
    const oldBuf = status === 'A' ? null : readAt(cwd, mergeBase, path)
    const newBuf = status === 'D' ? null : readAt(cwd, head, path)
    const asText = (buf) => (buf == null ? null : buf.includes(0) ? '\0' : buf.toString('utf8'))
    entries.push({ status, oldMode, newMode, path, oldText: asText(oldBuf), newText: asText(newBuf) })
  }
  return { mergeBase, entries }
}

export function classifyGit(cwd, base, head) {
  const { mergeBase, entries } = entriesFromGit(cwd, base, head)
  return { mergeBase, ...classifyEntries(entries) }
}

function writeSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  const modeName = result.mode === 'light' ? '轻量 / light' : '全量 / full'
  const body = [
    `### CI 范围：${modeName}`,
    '',
    result.reasonZh,
    '',
    result.reasonEn,
    '',
    result.mode === 'light'
      ? '轻量路径只核对各处版本号一致，并且都是 x.y.z。不一致就失败，不会记成通过。全量的 lint、Rust、smoke 和端到端测试这次不跑。'
      : '全量路径会跑原有的 lint、Rust 测试、smoke，以及纸面、笔迹和公式的端到端测试。',
    '',
    result.mode === 'light'
      ? 'The light path only checks that the recorded versions match and are x.y.z. A mismatch fails this check. Lint, Rust, smoke, and end-to-end tests do not run.'
      : 'The full path runs the existing lint, Rust tests, smoke tests, and the sheet, ink, and plot end-to-end tests.',
    '',
  ].join('\n')
  console.log(body)
  if (summaryPath) {
    execFileSync('tee', ['-a', summaryPath], { input: body })
  }
  if (process.env.GITHUB_OUTPUT) {
    execFileSync('tee', ['-a', process.env.GITHUB_OUTPUT], { input: `mode=${result.mode}\n` })
  }
}

function resolvePair(cwd) {
  const event = process.env.GITHUB_EVENT_NAME || ''
  if (event === 'workflow_dispatch') {
    return { forced: { mode: 'full', reasonZh: '手动运行没有可比较的基线，改走全量。', reasonEn: 'A manual run has no diff baseline, so the full test runs.' } }
  }
  if (event === 'pull_request') {
    const number = process.env.PR_NUMBER || ''
    const baseRef = process.env.PR_BASE_REF || ''
    if (!/^\d+$/.test(number) || !/^[\w./-]+$/.test(baseRef)) {
      throw new Error('The pull request baseline is not usable.')
    }
    git(cwd, ['fetch', 'origin', `+refs/heads/${baseRef}:refs/remotes/origin/pr-base`])
    git(cwd, ['fetch', 'origin', `+refs/pull/${number}/head:refs/remotes/origin/pr-head`])
    return {
      base: process.env.PR_BASE_SHA || git(cwd, ['rev-parse', 'refs/remotes/origin/pr-base']).trim(),
      head: process.env.PR_HEAD_SHA || git(cwd, ['rev-parse', 'refs/remotes/origin/pr-head']).trim(),
    }
  }
  if (event === 'push') {
    const before = process.env.PUSH_BEFORE || ''
    const head = process.env.GITHUB_SHA || ''
    if (!gitOk(cwd, ['merge-base', '--is-ancestor', before, head])) {
      throw new Error('The push baseline is not an ancestor of the new commit.')
    }
    return { base: before, head }
  }
  throw new Error(`Unsupported event ${event || '(empty)'}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const cwd = process.cwd()
    const pair = resolvePair(cwd)
    const result = pair.forced || classifyGit(cwd, pair.base, pair.head)
    writeSummary(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`CI scope failed: ${message}`)
    console.error('The baseline could not be classified. This check fails instead of passing.')
    process.exit(1)
  }
}
