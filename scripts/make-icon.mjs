/**
 * Flat icon in the kraft color already used by `.kraft-page` (#c9a473).
 * The repo has no MathScrap logomark. public/favicon.svg is the Vite template
 * and is not reused here.
 */
import { PNG } from 'pngjs'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packaging/icon-source.png')
const size = 1024
const png = new PNG({ width: size, height: size })
for (let i = 0; i < png.data.length; i += 4) {
  png.data[i] = 0xc9
  png.data[i + 1] = 0xa4
  png.data[i + 2] = 0x73
  png.data[i + 3] = 255
}
png.pack().pipe(createWriteStream(out)).on('finish', () => console.log(out))
