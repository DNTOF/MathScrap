/**
 * Locale catalog parity, English-mode leftovers, and saved-language behavior.
 * Formula text and sample blocks must stay byte-for-byte when the language changes.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLES } from '../src/board/samples.ts'
import { localizeGeo } from '../src/i18n/geometry.ts'
import { applyLang, getLang, LANG_KEY, readSavedLang, resolveLocale, t, writeSavedLang } from '../src/i18n/locale.ts'
import { en, zh, type MessageKey } from '../src/i18n/messages.ts'

const HAN = /\p{Script=Han}/u
const zhKeys = Object.keys(zh) as MessageKey[]
const enKeys = Object.keys(en)
assert.deepEqual([...enKeys].sort(), [...zhKeys].sort(), 'zh and en keys differ')
for (const key of zhKeys) assert.equal(typeof en[key], 'string', key)

/** English strings may quote Chinese input syntax. The language name on the switch stays 中文. */
const HAN_IN_EN = new Set<MessageKey>(['langZh', 'errThrough', 'errTangent', 'errChord', 'errCircleThrough', 'errCircleBit', 'errCircleNeed'])
const leaked = zhKeys.filter((key) => !HAN_IN_EN.has(key) && HAN.test(en[key]))
assert.deepEqual(leaked, [], `English catalog still has Chinese: ${leaked.join(', ')}`)
assert.equal(en.langZh, '中文')

assert.equal(resolveLocale(null, 'zh-CN'), 'zh')
assert.equal(resolveLocale(null, 'zh-Hans-CN'), 'zh')
assert.equal(resolveLocale(undefined, 'en-US'), 'en')
assert.equal(resolveLocale('', 'fr-FR'), 'en')
assert.equal(resolveLocale(null, undefined), 'en')
assert.equal(resolveLocale('en', 'zh-CN'), 'en')
assert.equal(resolveLocale('zh', 'en-US'), 'zh')
assert.equal(resolveLocale('fr', 'zh-CN'), 'zh')

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  },
})

writeSavedLang('en')
assert.equal(readSavedLang(), 'en')
assert.equal(store.get(LANG_KEY), 'en')
writeSavedLang('zh')
assert.equal(resolveLocale(readSavedLang(), 'en-US'), 'zh')

const formula = 'y = log_2(x)'
const blocks = SAMPLES.map((s) => s.blocks.join('\n'))
applyLang('zh')
assert.equal(getLang(), 'zh')
assert.equal(t('openCoordinates'), '打开坐标系')
assert.equal(t('details'), '详情')
assert.match(t('wroteMany', { n: 2 }), /2/)
applyLang('en')
assert.equal(t('openCoordinates'), 'Open coordinates')
assert.equal(t('details'), 'Details')
assert.equal(t('langZh'), '中文')
assert.equal(formula, 'y = log_2(x)')
assert.deepEqual(SAMPLES.map((s) => s.blocks.join('\n')), blocks)
assert.ok(SAMPLES.some((s) => s.blocks.includes('y = log_2(x)')))
assert.equal(t('domainLogb').includes('log'), true)
applyLang('en')
assert.equal(localizeGeo('余弦定理'), 'Law of cosines')
assert.equal(localizeGeo('y = x^2'), 'y = x^2')
assert.equal(localizeGeo('函数 f(x)'), 'Function f(x)')
assert.match(localizeGeo('第 2 / 3 组解'), /solution 2 \/ 3/)
applyLang('zh')
assert.equal(localizeGeo('余弦定理'), '余弦定理')
applyLang('en')

const allow = new Set([
  'src/i18n/messages.ts',
  'src/ai/client.ts',
  'src/ai/specs.ts',
  'src/math/statements.ts',
  'src/math/scene.ts',
  'src/input/snippets.ts',
  'src/board/samples.ts',
  'src/ocr/comer/source.ts',
  // Syntax examples and engine labels. FactsPanel quotes 过(1, 3). figure.ts matches 圆心/中心 from the Rust facts.
  'src/plot/FactsPanel.tsx',
  'src/plot/figure.ts',
  // Chinese keys are the engine's wording. English values are the screen text.
  'src/i18n/geometry.ts',
])
const hits: string[] = []
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === 'pkg' || name === 'node_modules') continue
      walk(path)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    const rel = path.replace(/\\/g, '/').replace(/^src\//, 'src/')
    if (allow.has(rel)) continue
    const text = readFileSync(path, 'utf8')
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\*.*\*\//g, '').replace(/\/\/.*$/, '')
      if (HAN.test(code)) hits.push(`${rel}:${i + 1}: ${line.trim()}`)
    })
  }
}
walk('src')
assert.deepEqual(hits, [], `Chinese remains outside the catalogs:\n${hits.join('\n')}`)

console.log(`i18n ok · ${zhKeys.length} keys · saved language wins · formulas unchanged`)
