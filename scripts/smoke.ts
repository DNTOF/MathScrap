import { readFileSync } from 'node:fs'
import { initSync } from '../src/wasm/pkg/mathcore.js'
import { analyze } from '../src/math/scene'

initSync({ module: readFileSync(new URL('../src/wasm/pkg/mathcore_bg.wasm', import.meta.url)) })

const samples = [
  'y = x^2 - 2\ny = 0.5x + 1',
  'z = sin(x)cos(y)',
  'x + y + z = 3; x - y + 2z = 1',
  '△ABC: a = 5, b = 7, C = 60°',
  'A(0,0), B(4,0), C(1,t), AC ⊥ BC',
  'f(x) = ax^2 + bx + c; f(0) = 1; f(1) = 0; f(3) = 4',
  'a = (1, 2, 2); b = (2, 1, k); a ⊥ b',
  'x^2 + y^2 - 4x + 2y = 4; y = x - 1',
  'A(0,0), B(4,0), C(5,3), D(1,3)',
  'y = kx + b, 过(1,3), 过(2,5)',
  'r(t) = (cos(t), sin(t), t/3)',
  'x^2+y^2+z^2 = 4',
  'y = ln(x)', 'y = 1/x',
]
for (const s of samples) {
  const a = analyze([{ id: '1', text: s }])
  console.log('\n===', s.replace(/\n/g, ' | '), '=> dim', a.dim, '|', a.dimReason, '| facts', a.factCount, '| rust calls', a.stats.calls, a.stats.ms.toFixed(2) + 'ms')
  if (a.errors.length) console.log('  ERRORS', a.errors)
  if (a.solve) console.log('  SOLVE', a.solve.unknowns, a.solve.solutions, a.solve.note)
  for (const sec of a.sections) console.log('  #', sec.title, '-', sec.subtitle, ':', sec.facts.slice(0, 40).map(f => `${f.label}=${f.value}`).join(' ; '))
  console.log('  objs', a.objects.map(o => o.type).join(','))
}
