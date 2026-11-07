/**
 * Confirm the recorded app versions are the same legal x.y.z.
 * A light classification still fails when this check fails.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function read(root, path) {
  return readFileSync(new URL(path, root), 'utf8')
}

function packageVersion(toml) {
  let inPackage = false
  for (const line of toml.split('\n')) {
    if (/^\[/.test(line)) inPackage = line.trim() === '[package]'
    const match = inPackage && line.match(/^version\s*=\s*"([^"]*)"/)
    if (match) return match[1]
  }
  return ''
}

function lockVersion(text, name) {
  const blocks = text.split('[[package]]').slice(1)
  for (const block of blocks) {
    if (block.match(new RegExp(`^name = "${name}"`, 'm'))) {
      const version = block.match(/^version = "([^"]*)"/m)
      return version ? version[1] : ''
    }
  }
  return ''
}

export function collectVersions(root) {
  const base = new URL(root.endsWith('/') ? root : `${root}/`, 'file:')
  const pkg = JSON.parse(read(base, 'package.json'))
  const lock = JSON.parse(read(base, 'package-lock.json'))
  const tauri = JSON.parse(read(base, 'src-tauri/tauri.conf.json'))
  const wasm = JSON.parse(read(base, 'src/wasm/pkg/package.json'))
  const versionTs = read(base, 'src/version.ts')
  const mcp = read(base, 'mcp/server.ts')
  const readme = read(base, 'README.md')
  const app = versionTs.match(/export const APP_VERSION = '([^']*)'/)
  const mcpVersion = mcp.match(/name: 'mathscrap', version: '([^']*)'/)
  const readmeVersions = [
    ...readme.matchAll(/版本 `(\d+\.\d+\.\d+)`/g),
    ...readme.matchAll(/version `(\d+\.\d+\.\d+)`/g),
  ].map((match) => match[1])
  return [
    ['package.json', pkg.version],
    ['package-lock.json', lock.version],
    ['package-lock.json packages', lock.packages?.['']?.version],
    ['src/version.ts', app ? app[1] : ''],
    ['src-tauri/tauri.conf.json', tauri.version],
    ['src-tauri/Cargo.toml', packageVersion(read(base, 'src-tauri/Cargo.toml'))],
    ['src-tauri/Cargo.lock', lockVersion(read(base, 'src-tauri/Cargo.lock'), 'mathscrap')],
    ['crates/mathcore/Cargo.toml', packageVersion(read(base, 'crates/mathcore/Cargo.toml'))],
    ['crates/mathcore/Cargo.lock', lockVersion(read(base, 'crates/mathcore/Cargo.lock'), 'mathcore')],
    ['src/wasm/pkg/package.json', wasm.version],
    ['mcp/server.ts', mcpVersion ? mcpVersion[1] : ''],
    ...readmeVersions.map((version, index) => [`README.md#${index + 1}`, version]),
  ]
}

export function checkVersions(root) {
  const found = collectVersions(root)
  const missing = found.filter(([, version]) => !version)
  if (missing.length) {
    throw new Error(`Missing version in ${missing.map(([name]) => name).join(', ')}`)
  }
  const illegal = found.filter(([, version]) => !SEMVER.test(version))
  if (illegal.length) {
    throw new Error(`Illegal version in ${illegal.map(([name, version]) => `${name}=${version}`).join(', ')}`)
  }
  const expected = found[0][1]
  const mismatch = found.filter(([, version]) => version !== expected)
  if (mismatch.length) {
    throw new Error(`Version mismatch against ${expected}: ${mismatch.map(([name, version]) => `${name}=${version}`).join(', ')}`)
  }
  return expected
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const version = checkVersions(`${process.cwd()}/`)
    console.log(`version check ok ${version}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

export function runVersionCheck() {
  return checkVersions(`${process.cwd()}/`)
}
