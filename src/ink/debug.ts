/**
 * Shared scratchpad the Board writes and the (opt-in) ink debug panel reads.
 * Deliberately a plain mutable object — the panel polls it, so pointer-move
 * handling never triggers extra React renders for debug bookkeeping.
 */
export interface InkDebugStats {
  /** pointerType of the last board pointer event */
  pointerType: string
  /** does the current stroke carry any real pressure (vs constant 0.5/0) */
  hasPressure: boolean
  /** is PointerEvent.getPredictedEvents available in this browser */
  nativePredicted: boolean
  /** predicted points shown for the last move, and where they came from */
  predictedCount: number
  predictedSource: 'off' | 'native' | 'self'
  /** Board pointer-move handling cost for the last draw move (ms) */
  handlerMs: number
  /** samples in the live stroke */
  strokePoints: number
  /** performance.now() of the last recorded move */
  lastMoveAt: number
}

export const inkDebugStats: InkDebugStats = {
  pointerType: '',
  hasPressure: false,
  nativePredicted: false,
  predictedCount: 0,
  predictedSource: 'off',
  handlerMs: 0,
  strokePoints: 0,
  lastMoveAt: 0,
}
