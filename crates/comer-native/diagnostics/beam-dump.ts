/**
 * Round-4 diagnostic: per-step decoder logits dump for a fixed token prefix,
 * used to compare native ORT vs onnxruntime-web on the near-tie beam
 * reshuffle (a2-eq-b-w5 second candidate).
 *
 *   npx tsx crates/comer-native/diagnostics/beam-dump.ts [fixtureName] [prefix as latex tokens]
 *
 * Prints, for every prefix length, the top-6 next-token candidates with their
 * raw logits — identical surface to the Rust `--dump-beam` runner.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { preprocessStrokes, type InkStroke } from '../../../src/ocr/comer/preprocess.ts'
import { arrowLetter, inkFixtures, isolatedSigma, pointPair, sumBar, sumGlyph } from '../../../src/ocr/comer/samples.ts'
import { vocabFromJson } from '../../../src/ocr/comer/source.ts'

const ort = await import('onnxruntime-web/wasm')
ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true
ort.env.wasm.wasmPaths = pathToFileURL(`${path.resolve('node_modules/onnxruntime-web/dist')}/`).href

const fixtureName = process.argv[2] ?? 'a2-eq-b-w5'
const prefixTokens = (process.argv[3] ?? 'a ^ { 2 } = b').split(/\s+/)

const vocab = vocabFromJson(JSON.parse(readFileSync('public/models/comer/vocab.json', 'utf8')))
const opts = { executionProviders: ['wasm' as const] }
const encoder = await ort.InferenceSession.create(readFileSync('public/models/comer/encoder_int8.onnx'), opts)
const decoder = await ort.InferenceSession.create(readFileSync('public/models/comer/decoder_int8.onnx'), opts)

const strokesOf = (name: string): InkStroke[] => {
  if (name === 'arrow') return arrowLetter()
  if (name === 'sum') return sumGlyph()
  if (name === 'sum-bar') return sumBar()
  if (name === 'sigma') return isolatedSigma()
  if (name === 'point') return pointPair()
  const short = name.replace(/-w\d$/, '')
  const hit = [...inkFixtures(3), ...inkFixtures(5)].find((f) => f.name === short)
  if (!hit) throw new Error(`unknown fixture ${name}`)
  return hit.strokes
}

const image = preprocessStrokes(strokesOf(fixtureName))
const enc = await encoder.run({
  pixel_values: new ort.Tensor('float32', image.tensor, [1, 1, image.height, image.width]),
  pixel_mask: new ort.Tensor('bool', image.mask, [1, image.height, image.width]),
})
const features = enc.encoder_features
const encMask = enc.encoder_mask

const ids = prefixTokens.map((t) => {
  const id = vocab.word2idx[t]
  if (id == null) throw new Error(`token ${t} not in vocab`)
  return id
})
console.log(`fixture=${fixtureName} prefix=[${ids.join(',')}] vocabSize=${vocab.vocab_size}`)

for (let len = 1; len <= ids.length + 1; len++) {
  const feed = len <= ids.length ? ids.slice(0, len) : [...ids, vocab.special_tokens.eos]
  const out = await decoder.run({
    encoder_features: features,
    encoder_mask: encMask,
    input_ids: new ort.Tensor('int64', BigInt64Array.from(feed.map((id) => BigInt(id))), [1, feed.length]),
  })
  const logits = out.logits.data as Float32Array
  const offset = (feed.length - 1) * vocab.vocab_size
  const row = Array.from({ length: vocab.vocab_size }, (_, i) => ({ id: i, v: logits[offset + i] }))
  row.sort((a, b) => b.v - a.v)
  const top = row.slice(0, 6).map((x) => `${vocab.idx2word[String(x.id)] ?? x.id}:${x.v.toFixed(4)}`).join(' ')
  console.log(`L=${feed.length} top: ${top}`)
}
features.dispose?.()
encMask.dispose?.()
