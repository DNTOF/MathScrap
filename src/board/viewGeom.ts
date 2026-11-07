import type { View } from './types'

/**
 * CSS-pixel point on the page to sheet coordinates.
 * `view` is the same translate/scale applied to the sheet. Both client coordinates
 * and that transform are CSS pixels, so devicePixelRatio is not part of the conversion.
 */
export function clientToWorld(clientX: number, clientY: number, origin: { left: number; top: number }, view: View) {
  return {
    x: (clientX - origin.left - view.x) / view.scale,
    y: (clientY - origin.top - view.y) / view.scale,
  }
}

/** How far the eraser reaches, in CSS pixels of the sheet. World radius is this divided by the view scale. */
export const ERASER_SCREEN_PX = 12

export function eraserWorldRadius(scale: number) {
  return ERASER_SCREEN_PX / scale
}
