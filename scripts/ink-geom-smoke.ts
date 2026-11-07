/**
 * Screen/world hit testing and undo transactions.
 * Run: npm run smoke:ink
 *
 * The eraser radius is MathScrap's own CSS-pixel reach. Device pixel ratio is not
 * a term in the conversion: client coordinates and the sheet transform are both CSS pixels.
 */
import assert from 'node:assert/strict'
import { applyRedo, applyUndo, pushCommit, sameDoc } from '../src/board/history.ts'
import { hitStroke, hitStrokeCapsule } from '../src/board/strokeGeom.ts'
import { blankDoc } from '../src/board/useDocument.ts'
import { clientToWorld, eraserWorldRadius, ERASER_SCREEN_PX } from '../src/board/viewGeom.ts'
import type { Stroke } from '../src/board/types.ts'

const ink = (pts: number[], width = 2): Stroke => ({ id: 's', pts, color: '#2b2118', width, style: 'ink', createdAt: 1 })

const view = { x: 30, y: 40, scale: 2 }
const origin = { left: 10, top: 20 }
const client = { x: origin.left + view.x + 100 * view.scale, y: origin.top + view.y + 80 * view.scale }
const world = clientToWorld(client.x, client.y, origin, view)
assert.deepEqual(world, { x: 100, y: 80 })
assert.deepEqual(clientToWorld(client.x, client.y, origin, view), world)

const radius = eraserWorldRadius(view.scale)
assert.equal(radius, ERASER_SCREEN_PX / view.scale)
const line = ink([100, 100, 0.5, 160, 100, 0.5])
assert.equal(hitStroke(line, 100, 105, radius), true)
assert.equal(hitStroke(line, 100, 130, radius), false)
assert.equal(hitStroke(line, 40, 100, radius), false)
assert.equal(hitStroke(line, 220, 100, radius), false)
assert.equal(hitStrokeCapsule(line, 40, 100, 220, 100, radius), true)

const upright = ink([0, 0, 0.5, 0, 200, 0.5])
assert.equal(hitStroke(upright, -80, 100, 12), false)
assert.equal(hitStroke(upright, 80, 100, 12), false)
assert.equal(hitStrokeCapsule(upright, -80, 100, 80, 100, 12), true)

const empty = blankDoc()
const card = { id: 'a', x: 10, y: 20, text: 'y = x' }
const placed = { ...empty, cards: [card] }
const samePlace = { ...empty, cards: [{ ...card }] }
const moved = { ...empty, cards: [{ ...card, x: 18 }] }
assert.equal(sameDoc(placed, samePlace), true)
assert.equal(sameDoc(placed, moved), false)

const untouched = pushCommit([], placed, samePlace, 'a')
assert.equal(untouched.changed, false)
assert.equal(untouched.past.length, 0)

const recorded = pushCommit([], placed, moved, 'a')
assert.equal(recorded.changed, true)
assert.equal(recorded.past[0]?.selected, 'a')
const undone = applyUndo(recorded.past, [], moved, null)
assert.equal(undone.changed, true)
assert.equal(undone.doc, placed)
assert.equal(undone.selected, 'a')
const redone = applyRedo(undone.past, undone.future, undone.doc, undone.selected)
assert.equal(redone.doc, moved)
assert.equal(redone.selected, null)
assert.equal(applyUndo([], [], empty, null).changed, false)

let past = recorded.past
let prev = moved
for (let i = 0; i < 130; i++) {
  const next = { ...empty, cards: [{ ...card, x: 100 + i }] }
  const step = pushCommit(past, prev, next, null)
  assert.equal(step.changed, true)
  past = step.past
  prev = next
}
assert.equal(past.length, 120)

const withStroke = { ...empty, strokes: [line] }
const erased = { ...empty, strokes: [] as Stroke[] }
const erase = pushCommit([], withStroke, erased, null)
assert.equal(erase.changed, true)
assert.equal(pushCommit(erase.past, erased, { ...erased, strokes: [] }, null).changed, false)

console.log('ink geom smoke passed')
