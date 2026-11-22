/**
 * Keep pen and finger strokes from turning into browser gestures on touch WebKit (iPad).
 *
 * iOS synthesises `click` / `dblclick` after a short, still touch, and starts text selection or the
 * callout on a long press. On the board, two quick taps or short marks (a dot, the bars of "=")
 * became a `dblclick`, which opened the formula composer while the pen was selected, and a held
 * stroke selected page text. A capacitive stylus reports `pointerType: 'touch'`, not `'pen'`.
 *
 * Rules:
 * - In ink tools (pen / marker / eraser) only a mouse double-click opens the composer. Pen and
 *   touch never do; the type tool, the toolbar button and keyboard shortcuts still do.
 * - Touches the board turns into ink, erasing or pinch are `preventDefault`ed, which stops click
 *   synthesis, selection, the callout and the loupe. Real controls and text fields are left alone.
 */
import type { Tool } from '../board/types'

export const INK_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['pen', 'marker', 'eraser'])

export function isInkTool(tool: Tool): boolean {
  return INK_TOOLS.has(tool)
}

interface Closest {
  closest?: (selector: string) => unknown
}

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
const INTERACTIVE = `${EDITABLE}, button, a[href], [role="button"], [data-no-board]`

function matches(target: unknown, selector: string): boolean {
  const el = target as Closest | null
  if (!el || typeof el.closest !== 'function') return false
  try {
    return el.closest(selector) != null
  } catch {
    return false
  }
}

/** A text field (or inside one) where selection and the keyboard must keep working. */
export function isEditableTarget(target: unknown): boolean {
  return matches(target, EDITABLE)
}

/** A control that needs its own click: buttons, links, fields, anything marked `data-no-board`. */
export function isInteractiveTarget(target: unknown): boolean {
  return matches(target, INTERACTIVE)
}

/** Board `dblclick`: true when it must not open or edit a formula. */
export function ignoreBoardDoubleClick(tool: Tool, lastPointerType: string | null): boolean {
  if (!isInkTool(tool)) return false
  return lastPointerType !== 'mouse'
}

export type BoardModeKind = 'draw' | 'erase' | 'pan' | 'pinch' | null

/** Native `touchstart` on the board: true when its default (click, selection, callout) must be cancelled. */
export function suppressBoardTouch(tool: Tool, mode: BoardModeKind, target: unknown): boolean {
  if (isInteractiveTarget(target)) return false
  if (mode === 'draw' || mode === 'erase' || mode === 'pinch') return true
  return isInkTool(tool)
}

/** `selectstart` on the board: only text fields may start a selection. */
export function blockBoardSelection(target: unknown): boolean {
  return !isEditableTarget(target)
}
