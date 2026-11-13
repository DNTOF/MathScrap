/**
 * Decide which CI path a diff needs.
 *   docs       documentation only: consistency checks only
 *   version    whitelisted version fields (optionally plus docs): consistency checks, packages still build on push
 *   packaging  packaging scripts, icons, the iOS workflow (optionally plus docs/version): packaging validation, no math suite
 *   full       anything else, including mixed or unclassified changes: the whole test suite
 * Added, deleted, or renamed files are allowed only when every path involved is documentation or packaging.
 * A broken baseline fails the process instead of passing.
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

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

const DOC_ROOT_FILES = new Set(['README.md', 'CONTRIBUTING.md', 'NOTICE', 'LICENSE'])

export function isDocsPath(path) {
  if (typeof path !== 'string' || !path) return false
  if (DOC_ROOT_FILES.has(path)) return true
  if (path.startsWith('docs/')) return true
  if (path.startsWith('signing/') && path.endsWith('.md')) return true
  if (path.startsWith('experiments/') && path.endsWith('.md')) return true
  if (path.startsWith('.github/ISSUE_TEMPLATE/')) return true
  if (/^\.github\/[^/]+\.md$/.test(path)) return true
  return false
}

/** Binary files are accepted as documentation only under docs/ (screenshots). */
function docsBinaryOk(path) {
  return path.startsWith('docs/')
}

const PACKAGING_FILES = new Set([
  '.github/workflows/package-ios.yml',
  'scripts/checksum-artifacts.mjs',
  'scripts/android-release-signing.mjs',
  'scripts/compact-debug-apk.py',
  'scripts/make-icon.mjs',
  'scripts/make-rounded-icon.mjs',
])

export function isPackagingPath(path) {
  if (typeof path !== 'string' || !path) return false
  if (PACKAGING_FILES.has(path)) return true
  if (/^scripts\/package-[\w-]+\.sh$/.test(path)) return true
  if (path.startsWith('packaging/')) return true
  if (path.startsWith('src-tauri/icons/')) return true
  return false
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

const RANK = { docs: 0, version: 1, packaging: 2, full: 3 }

const REASONS = {
  docs: ['变化都是文档。', 'Every change is documentation.'],
  version: ['变化都在文档或版本字段白名单内。', 'Every change is documentation or a whitelisted version field.'],
  packaging: ['变化只涉及打包脚本、图标或 iOS 打包流程（可含文档和版本字段）。', 'The changes only touch packaging scripts, icons, or the iOS packaging workflow (plus documentation or version fields).'],
}

function hasNul(text) {
  return (text || '').includes('\0')
}

/** Category of a single entry: docs, version, packaging, or full. */
function classifyEntry(entry) {
  const status = entry.status || ''
  const paths = [entry.oldPath, entry.path].filter(Boolean)
  if (!paths.length) return ['full', '(unknown) 无法识别']
  const label = paths.join(' -> ')
  if (paths.every(isDocsPath)) {
    const binary = hasNul(entry.oldText) || hasNul(entry.newText)
    if (binary && !paths.every(docsBinaryOk)) return ['full', `${label} 无法按文档文本识别`]
    return ['docs', `${label} 只是文档`]
  }
  if (paths.every(isPackagingPath)) return ['packaging', `${label} 只是打包`]
  if (status.startsWith('R') || status.startsWith('C') || status === 'T') return ['full', `${label} 被重命名或改变类型`]
  if (status === 'D' || status === 'A') return ['full', `${entry.path} 被${status === 'D' ? '删除' : '新增'}`]
  if (status !== 'M' || entry.oldMode !== entry.newMode) return ['full', `${entry.path || '(unknown)'} 无法按字段识别`]
  if (VERSION_FILES.has(entry.path) && versionFieldOnly(entry.path, entry.oldText, entry.newText)) {
    return ['version', `${entry.path} 只有版本字段变化`]
  }
  return ['full', `${entry.path} 含有版本字段以外的变化`]
}

export function classifyEntries(entries) {
  if (!Array.isArray(entries)) {
    return { mode: 'full', reasonZh: '分类输入无法读取，改走全量。', reasonEn: 'The classifier input could not be read, so the full test runs.' }
  }
  if (entries.length === 0) {
    return { mode: 'docs', reasonZh: '基线之间没有文件变化。', reasonEn: 'There are no file changes between the baselines.' }
  }
  let mode = 'docs'
  const notes = []
  const heavy = []
  for (const entry of entries) {
    const [kind, note] = classifyEntry(entry || {})
    notes.push(note)
    if (kind === 'full') heavy.push(note)
    if (RANK[kind] > RANK[mode]) mode = kind
  }
  if (heavy.length) {
    return {
      mode: 'full',
      reasonZh: `这些变化需要全量测试：${heavy.join('；')}。`,
      reasonEn: `These changes need the full test: ${heavy.join('; ')}.`,
    }
  }
  return {
    mode,
    reasonZh: `${REASONS[mode][0]}${notes.join('；')}。`,
    reasonEn: `${REASONS[mode][1]} ${notes.join('; ')}.`,
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

const MODE_NAMES = {
  docs: '文档 / docs',
  version: '版本 / version',
  packaging: '打包 / packaging',
  full: '全量 / full',
}

function writeSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  const full = result.mode === 'full'
  const body = [
    `### CI 范围：${MODE_NAMES[result.mode] || result.mode}`,
    '',
    result.reasonZh,
    '',
    result.reasonEn,
    '',
    full
      ? '全量路径会跑原有的 lint、Rust 测试、smoke，以及纸面、笔迹和公式的端到端测试。'
      : '这次不跑数学测试套件（lint、Rust、smoke、端到端）。一致性检查照常运行：版本号一致且都是 x.y.z、分类器回归、打包脚本语法和工作流 YAML。不一致就失败，不会记成通过。' + (result.mode === 'packaging' ? '打包路径会实际构建安装包来验证。' : ''),
    '',
    full
      ? 'The full path runs the existing lint, Rust tests, smoke tests, and the sheet, ink, and plot end-to-end tests.'
      : 'The math suite (lint, Rust, smoke, end-to-end) does not run. Consistency checks still run: matching x.y.z versions, the classifier regression, packaging script syntax, and workflow YAML. A failure fails the run.' + (result.mode === 'packaging' ? ' The packaging path builds the packages to validate them.' : ''),
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
