import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockBoardSelection, ignoreBoardDoubleClick, isEditableTarget, isInteractiveTarget, suppressBoardTouch } from './inputGuard'

/** Minimal `closest`: the element "matches" when any of its tags appears in the selector list. */
function el(...tags: string[]) {
  return {
    closest(selector: string) {
      const parts = selector.split(',').map((s) => s.trim())
      return tags.some((tag) => parts.includes(tag)) ? {} : null
    },
  }
}

const paper = el('div')
const textarea = el('textarea')
const button = el('button')
const noBoard = el('[data-no-board]')
const editable = el('[contenteditable="true"]')

test('pen / touch double-tap in ink tools never opens the composer; mouse still does', () => {
  for (const tool of ['pen', 'marker', 'eraser'] as const) {
    assert.equal(ignoreBoardDoubleClick(tool, 'touch'), true, `${tool} touch (capacitive stylus)`)
    assert.equal(ignoreBoardDoubleClick(tool, 'pen'), true, `${tool} pen`)
    assert.equal(ignoreBoardDoubleClick(tool, null), true, `${tool} unknown pointer`)
    assert.equal(ignoreBoardDoubleClick(tool, 'mouse'), false, `${tool} mouse keeps desktop double-click`)
  }
  assert.equal(ignoreBoardDoubleClick('type', 'touch'), false, 'the type tool is an explicit choice')
  assert.equal(ignoreBoardDoubleClick('select', 'pen'), false)
})

test('board touches that draw, erase or pinch cancel the browser default; controls keep it', () => {
  assert.equal(suppressBoardTouch('pen', 'draw', paper), true)
  assert.equal(suppressBoardTouch('eraser', 'erase', paper), true)
  assert.equal(suppressBoardTouch('select', 'pinch', paper), true)
  assert.equal(suppressBoardTouch('pen', 'pan', paper), true, 'palm rejection in an ink tool still blocks selection')
  assert.equal(suppressBoardTouch('pen', null, paper), true)
  assert.equal(suppressBoardTouch('select', 'pan', paper), false, 'select tool keeps taps for cards')
  assert.equal(suppressBoardTouch('type', 'pan', paper), false)
  for (const target of [textarea, button, noBoard, editable]) assert.equal(suppressBoardTouch('pen', 'draw', target), false)
})

test('selection starts only in text fields', () => {
  assert.equal(blockBoardSelection(paper), true)
  assert.equal(blockBoardSelection(null), true)
  assert.equal(blockBoardSelection(textarea), false)
  assert.equal(blockBoardSelection(editable), false)
  assert.equal(isEditableTarget(button), false)
  assert.equal(isInteractiveTarget(button), true)
  assert.equal(isInteractiveTarget({}), false, 'non-elements (text nodes, window) are not controls')
})
