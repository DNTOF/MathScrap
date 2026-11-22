/**
 * Rounded-corner desktop icon master from packaging/logo/app-icon.png.
 * Corners outside the rounded square become transparent (4x4 supersampled edge).
 * Windows, macOS, Linux and the web favicon use this. iOS keeps the opaque square
 * master because iOS masks it itself; Android keeps its own adaptive/round icons.
 *
 *   node scripts/make-rounded-icon.mjs
 *   npx tauri icon packaging/logo/app-icon-rounded.png -o <tmp>   (then copy the desktop files)
 */
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = PNG.sync.read(readFileSync(path.join(root, 'packaging/logo/app-icon.png')))
const size = src.width
if (src.height !== size) throw new Error('app-icon.png must be square')
// Corner radius as a share of the edge, close to the macOS / iOS app icon corner.
const radius = size * 0.2237
const out = new PNG({ width: size, height: size })
const SS = 4
function inside(x, y) {
  const cx = Math.min(Math.max(x, radius), size - radius)
  const cy = Math.min(Math.max(y, radius), size - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
}
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    let hits = 0
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++
    out.data[i] = src.data[i]
    out.data[i + 1] = src.data[i + 1]
    out.data[i + 2] = src.data[i + 2]
    out.data[i + 3] = Math.round((src.data[i + 3] * hits) / (SS * SS))
  }
}
const dest = path.join(root, 'packaging/logo/app-icon-rounded.png')
writeFileSync(dest, PNG.sync.write(out))
console.log(dest)