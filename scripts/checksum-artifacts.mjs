import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.argv[2] ?? 'packaging/out')
const names = readdirSync(dir)
  .filter((name) => name !== 'SHA256SUMS')
  .filter((name) => statSync(path.join(dir, name)).isFile())
  .sort()
const lines = names.map((name) => {
  const file = path.join(dir, name)
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
  return `${sha}  ${name}`
})
writeFileSync(path.join(dir, 'SHA256SUMS'), `${lines.join('\n')}\n`)
console.log(lines.join('\n'))
