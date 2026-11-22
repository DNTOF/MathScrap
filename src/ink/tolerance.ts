/**
 * Per-pointer-type tolerances — pure functions.
 *
 * Idea learned from studying established whiteboard behaviour (not their code):
 * mice want tight tolerances, fingers need room, pens sit in between. The drag
 * threshold (tap vs. drag) and the eraser hit tolerance each come in three
 * flavours, and the drag threshold is specified in DIP so it must be divided by
 * the current zoom to become a world-space distance.
 */

export type PointerKind = 'mouse' | 'touch' | 'pen'

/** Map a DOM pointerType onto the three kinds; anything unknown behaves like a mouse. */
export function toPointerKind(pointerType: string): PointerKind {
  return pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse'
}

/** Tap-vs-drag thresholds in DIP (mouse / touch / pen). */
export const DRAG_THRESHOLD_DIP: Record<PointerKind, number> = { mouse: 1, touch: 16, pen: 4 }

/** Eraser hit tolerances in DIP (mouse / touch / pen). */
export const HIT_TOLERANCE_DIP: Record<PointerKind, number> = { mouse: 3, touch: 10, pen: 5 }

/**
 * Drag threshold in world units — DIP divided by the current zoom, so the
 * on-screen distance stays constant while zooming. `scale` is the board's view
 * scale (clamped to [0.2, 4] by the app).
 */
export function dragThresholdWorld(kind: PointerKind, scale: number): number {
  return DRAG_THRESHOLD_DIP[kind] / scale
}

/** Eraser hit tolerance in world units, same DIP ÷ zoom rule. */
export function hitToleranceWorld(kind: PointerKind, scale: number): number {
  return HIT_TOLERANCE_DIP[kind] / scale
}

/**
 * Does any sample carry a real pressure value? Constant 0.5 (main's "no
 * pressure" fill) or constant 0 mean a pressure-less device — render and think
 * of the stroke as pressure-free, never as pressure-varying.
 */
export function hasRealPressure(pts: number[]): boolean {
  for (let i = 2; i < pts.length; i += 3) if (pts[i] !== 0.5 && pts[i] !== 0) return true
  return false
}

/** A press shorter than this counts as a tap even if it barely moved — deliberate short ticks take longer. */
export const TAP_MAX_DURATION_MS = 250

/**
 * Is this stroke a tap rather than a drag? Two conditions, both required:
 * every sample stays within `thresholdWorld` of the pen-down point AND the
 * press was quick (≤ TAP_MAX_DURATION_MS) — a slow, deliberate short tick stays
 * a stroke. `durationMs` is the press duration (pointerdown → pointerup);
 * without it the old displacement-only rule applies. Single-point strokes are
 * always taps.
 */
export function isTapStroke(pts: number[], thresholdWorld: number, durationMs?: number): boolean {
  const x0 = pts[0]
  const y0 = pts[1]
  for (let i = 0; i < pts.length; i += 3) {
    if (Math.hypot(pts[i] - x0, pts[i + 1] - y0) >= thresholdWorld) return false
  }
  return durationMs === undefined || durationMs <= TAP_MAX_DURATION_MS
}
