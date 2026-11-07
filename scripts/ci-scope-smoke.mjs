/**
 * Regression cases for the CI scope classifier and the light version check.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyEntries, classifyGit } from './ci-scope.mjs'
import { checkVersions } from './ci-version-check.mjs'

let failed = 0

function check(label, actual, expected) {
  if (actual !== expected) {
    failed += 1
    console.error(`FAIL ${label}: ${actual} !== ${expected}`)
  } else {
    console.log(`ok ${label}`)
  }
}

function entry(path, oldText, newText, status = 'M') {
  return { status, oldMode: '100644', newMode: '100644', path, oldText, newText }
}

const pkg = (version, extra = '') => `{"name":"mathscrap","version":"${version}"${extra}}`
const versionTs = (version) => `export const APP_VERSION = '${version}'\n`

check('version fields only', classifyEntries([
  entry('package.json', pkg('0.0.1'), pkg('0.0.2')),
  entry('src/version.ts', versionTs('0.0.1'), versionTs('0.0.2')),
  entry('src-tauri/tauri.conf.json', pkg('0.0.1'), pkg('0.0.2')),
  entry('src/wasm/pkg/package.json', pkg('0.0.1'), pkg('0.0.2')),
  entry('mcp/server.ts', "const server = new Server({ name: 'mathscrap', version: '0.0.1' }, { capabilities: { tools: {} } })\n", "const server = new Server({ name: 'mathscrap', version: '0.0.2' }, { capabilities: { tools: {} } })\n"),
  entry('src-tauri/Cargo.toml', '[package]\nname = "mathscrap"\nversion = "0.0.1"\n', '[package]\nname = "mathscrap"\nversion = "0.0.2"\n'),
  entry('crates/mathcore/Cargo.toml', '[package]\nname = "mathcore"\nversion = "0.0.1"\n\n[dependencies]\nserde = { version = "1" }\n', '[package]\nname = "mathcore"\nversion = "0.0.2"\n\n[dependencies]\nserde = { version = "1" }\n'),
  entry('package-lock.json', JSON.stringify({ version: '0.0.1', packages: { '': { version: '0.0.1', dependencies: { react: '^19.0.0' } }, react: { version: '19.0.0' } } }), JSON.stringify({ version: '0.0.2', packages: { '': { version: '0.0.2', dependencies: { react: '^19.0.0' } }, react: { version: '19.0.0' } } })),
  entry('src-tauri/Cargo.lock', '[[package]]\nname = "mathscrap"\nversion = "0.0.1"\n', '[[package]]\nname = "mathscrap"\nversion = "0.0.2"\n'),
]).mode, 'light')

check('version plus function', classifyEntries([
  entry('package.json', pkg('0.0.1'), pkg('0.0.2')),
  entry('src/board/ink.ts', 'export function ink() { return 1 }\n', 'export function ink() { return 2 }\n'),
]).mode, 'full')

check('package scripts', classifyEntries([
  entry('package.json', pkg('0.0.1', ',"scripts":{"test":"a"}'), pkg('0.0.1', ',"scripts":{"test":"b"}')),
]).mode, 'full')

check('package dependency', classifyEntries([
  entry('package.json', pkg('0.0.1', ',"dependencies":{"react":"1"}'), pkg('0.0.1', ',"dependencies":{"react":"2"}')),
]).mode, 'full')

check('lock dependency', classifyEntries([
  entry('package-lock.json', '{"version":"0.0.1","packages":{"":{"version":"0.0.1"},"react":{"version":"1.0.0"}}}', '{"version":"0.0.1","packages":{"":{"version":"0.0.1"},"react":{"version":"2.0.0"}}}'),
]).mode, 'full')

check('workflow', classifyEntries([
  entry('.github/workflows/package.yml', 'name: package\n', 'name: package\njobs: {}\n'),
]).mode, 'full')

check('test script', classifyEntries([
  entry('scripts/ci-scope.mjs', 'export const a = 1\n', 'export const a = 2\n'),
]).mode, 'full')

check('unknown', classifyEntries([
  entry('src/new-file.ts', 'a\n', 'b\n'),
]).mode, 'full')

check('delete', classifyEntries([
  { status: 'D', oldMode: '100644', newMode: '000000', path: 'README.md', oldText: 'a\n', newText: null },
]).mode, 'full')

check('rename', classifyEntries([
  { status: 'R100', oldMode: '100644', newMode: '100644', oldPath: 'README.md', path: 'docs/README.md', oldText: null, newText: null },
]).mode, 'full')

check('docs only', classifyEntries([
  entry('README.md', '版本 `0.0.1`\n', '版本 `0.0.1`\n\n更多说明。\n'),
]).mode, 'light')

check('invalid json is full', classifyEntries([
  entry('package.json', pkg('0.0.1'), '{'),
]).mode, 'full')

check('empty diff', classifyEntries([]).mode, 'light')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

const repo = mkdtempSync(join(tmpdir(), 'ci-scope-'))
git(repo, ['init', '-q', '-b', 'main'])
git(repo, ['config', 'user.email', '3174600270@qq.com'])
git(repo, ['config', 'user.name', 'DNT_OF'])
writeFileSync(join(repo, 'package.json'), pkg('0.0.1'))
git(repo, ['add', 'package.json'])
git(repo, ['commit', '-q', '-m', 'base'])
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
writeFileSync(join(repo, 'package.json'), pkg('0.0.2'))
git(repo, ['commit', '-q', '-am', 'version one'])
writeFileSync(join(repo, 'package.json'), pkg('0.0.3'))
git(repo, ['commit', '-q', '-am', 'version two'])
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
check('multi commit version', classifyGit(repo, base, head).mode, 'light')
writeFileSync(join(repo, 'src-note.ts'), 'export const n = 1\n')
git(repo, ['add', 'src-note.ts'])
git(repo, ['commit', '-q', '-m', 'code'])
const mixed = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
check('multi commit mixed', classifyGit(repo, base, mixed).mode, 'full')
let baselineFailed = false
try {
  classifyGit(repo, '0'.repeat(40), head)
} catch {
  baselineFailed = true
}
check('missing baseline fails', baselineFailed, true)
rmSync(repo, { recursive: true, force: true })

const tree = mkdtempSync(join(tmpdir(), 'ci-version-'))
function plant(version, readmeVersion = version) {
  mkdirSync(join(tree, 'src-tauri'), { recursive: true })
  mkdirSync(join(tree, 'crates/mathcore'), { recursive: true })
  mkdirSync(join(tree, 'src/wasm/pkg'), { recursive: true })
  mkdirSync(join(tree, 'mcp'), { recursive: true })
  writeFileSync(join(tree, 'package.json'), pkg(version))
  writeFileSync(join(tree, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }))
  writeFileSync(join(tree, 'src/version.ts'), versionTs(version))
  writeFileSync(join(tree, 'src-tauri/tauri.conf.json'), JSON.stringify({ version }))
  writeFileSync(join(tree, 'src-tauri/Cargo.toml'), `[package]\nname = "mathscrap"\nversion = "${version}"\n`)
  writeFileSync(join(tree, 'src-tauri/Cargo.lock'), `[[package]]\nname = "mathscrap"\nversion = "${version}"\n`)
  writeFileSync(join(tree, 'crates/mathcore/Cargo.toml'), `[package]\nname = "mathcore"\nversion = "${version}"\n`)
  writeFileSync(join(tree, 'crates/mathcore/Cargo.lock'), `[[package]]\nname = "mathcore"\nversion = "${version}"\n`)
  writeFileSync(join(tree, 'src/wasm/pkg/package.json'), pkg(version))
  writeFileSync(join(tree, 'mcp/server.ts'), `new Server({ name: 'mathscrap', version: '${version}' })\n`)
  writeFileSync(join(tree, 'README.md'), `版本 \`${readmeVersion}\`\nversion \`${readmeVersion}\`\n`)
}
plant('1.2.3')
check('versions agree', checkVersions(`${tree}/`), '1.2.3')
let mismatch = false
try {
  plant('1.2.3', '9.9.9')
  checkVersions(`${tree}/`)
} catch {
  mismatch = true
}
check('readme mismatch fails', mismatch, true)
let illegal = false
try {
  plant('1.2')
  checkVersions(`${tree}/`)
} catch {
  illegal = true
}
check('illegal semver fails', illegal, true)
rmSync(tree, { recursive: true, force: true })

check('repo versions agree', checkVersions(`${process.cwd()}/`), '0.0.1')

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('ci-scope smoke ok')
