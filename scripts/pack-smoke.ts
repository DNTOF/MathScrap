import { readFileSync } from 'node:fs'
import { TOOL_SPECS } from '../src/ai/specs.ts'
import { assetUrl } from '../src/lib/asset.ts'
import { parseSheet, serializeSheet } from '../src/board/sheetFile.ts'
import { APP_VERSION } from '../src/version.ts'
import type { Doc } from '../src/board/types.ts'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { version: string; productName: string; identifier: string }

function check(cond: unknown, message: string) {
  if (!cond) throw new Error(message)
}

check(pkg.version === APP_VERSION, `package.json version ${pkg.version} != ${APP_VERSION}`)
check(tauri.version === APP_VERSION, `tauri.conf.json version ${tauri.version} != ${APP_VERSION}`)
check(tauri.productName === 'MathScrap', 'product name must stay MathScrap')
check(tauri.identifier === 'app.mathscrap', `unexpected identifier ${tauri.identifier}`)

check(assetUrl('models/comer/vocab.json', '/') === '/models/comer/vocab.json', 'absolute base')
check(assetUrl('/ort/', '/') === '/ort/', 'leading slash is stripped once')
check(assetUrl('ort/file.wasm', './') === './ort/file.wasm', 'relative base stays inside the bundle')
check(!assetUrl('models/comer/encoder_int8.onnx', '/').startsWith('http'), 'model URL is not a remote host')

const doc: Doc = {
  strokes: [{ id: 's1', pts: [1, 2, 0.5, 3, 4, 0.4], color: '#2b2118', width: 3, style: 'ink', createdAt: 1 }],
  cards: [{ id: 'c1', x: 10, y: 20, text: 'y = x' }],
  stickers: [],
}
const raw = serializeSheet(doc)
const back = parseSheet(raw)
check(back.cards[0]?.text === 'y = x' && back.strokes.length === 1, 'round trip')
check(parseSheet(JSON.stringify(doc)).cards[0]?.text === 'y = x', 'plain stored sheet')

const kept = parseSheet('{"format":"mathscrap.sheet","version":1,"doc":{"strokes":[],"cards":[{"id":"c1","x":1,"y":2,"text":"y = x","__proto__":{"polluted":true}}],"stickers":[]}}')
check(kept.cards[0]?.text === 'y = x', 'extra card fields are not kept')
check(!('polluted' in {}), 'import does not pollute Object.prototype')

const junk = [
  '{"format":"other","version":1,"doc":{}}',
  '{"format":"mathscrap.sheet","version":99,"doc":{"strokes":[],"cards":[],"stickers":[]}}',
  '{"strokes":[{"id":"s1","pts":[1,2],"color":"#fff","width":3,"style":"ink","createdAt":1}],"cards":[],"stickers":[]}',
  '{"strokes":[{"id":"s1","pts":[1,2,0],"color":"javascript:alert(1)","width":3,"style":"ink","createdAt":1}],"cards":[],"stickers":[]}',
  '{"strokes":[],"cards":[{"id":"c1","x":1,"y":2,"text":' + JSON.stringify('x'.repeat(9000)) + '}],"stickers":[]}',
  '[]',
  '"y = x"',
]
for (const sample of junk) {
  let threw = false
  try {
    parseSheet(sample)
  } catch {
    threw = true
  }
  check(threw, `should reject ${sample.slice(0, 60)}`)
}

const withProto = parseSheet('{"strokes":[],"cards":[{"id":"c1","x":1,"y":2,"text":"y = 1"}],"stickers":[],"__proto__":{"admin":true},"eval":"process.exit(1)"}')
check(withProto.cards.length === 1 && !('eval' in withProto), 'unknown fields are dropped')

function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon((value as Record<string, unknown>)[key])]))
  }
  return value
}
const published = JSON.parse(readFileSync(new URL('../mcp/tools.json', import.meta.url), 'utf8')) as unknown
const fromSpecs = TOOL_SPECS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
check(JSON.stringify(canon(fromSpecs)) === JSON.stringify(canon(published)), 'mcp/tools.json does not match the page tool schemas')

console.log(`pack-smoke ok ${APP_VERSION}`)
