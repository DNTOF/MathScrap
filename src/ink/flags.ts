/**
 * Experiment switches for the ink-feel prototype (prediction + smoothing + capsule eraser).
 * Everything here is opt-in: with the flags off the board behaves exactly like main.
 *
 * Learnings are borrowed as *ideas* from studying how established whiteboard apps
 * feel (Seewo-style tolerances, midpoint Bézier smoothing, short-horizon gated
 * prediction) — no third-party code or resources were copied.
 */

export interface InkFlags {
  /** near-point dedupe (0.5 DIP) + midpoint quadratic-Bézier smoothing of saved strokes */
  smoothing: boolean
  /** live predicted-tail display while drawing (display-only, never persisted) */
  prediction: boolean
  /** render the predicted tail as its own translucent ghost path instead of merging it into the ink (needs prediction) */
  predictionGhost: boolean
  /** swept-capsule eraser hit testing (catches strokes skipped during fast motion) */
  capsuleEraser: boolean
  /** per-pointer-type drag thresholds and eraser hit tolerances (mouse/touch/pen, DIP ÷ zoom) */
  pointerTolerance: boolean
  /** wet ink draws from an incremental segment cache instead of resampling the whole stroke per frame (needs smoothing) */
  wetIncremental: boolean
}

export const DEFAULT_INK_FLAGS: InkFlags = {
  smoothing: false,
  prediction: false,
  predictionGhost: false,
  capsuleEraser: false,
  pointerTolerance: false,
  wetIncremental: false,
}

export const INK_FLAGS_STORAGE_KEY = 'mathscrap.ink-flags.v1'

/** URL param per flag, e.g. `?ink-smooth=1&ink-predict=1&ink-ghost=1` (0/false clears). */
const PARAMS: Record<keyof InkFlags, string> = {
  smoothing: 'ink-smooth',
  prediction: 'ink-predict',
  predictionGhost: 'ink-ghost',
  capsuleEraser: 'ink-capsule',
  pointerTolerance: 'ink-tolerance',
  wetIncremental: 'ink-wet-inc',
}

const parseParam = (v: string | null): boolean | undefined =>
  v == null || v === '' ? undefined : !(v === '0' || v === 'false' || v === 'off')

/** Pure: defaults ← persisted JSON ← URL params. Bad input quietly falls back. */
export function parseInkFlags(search: string, stored: string | null): InkFlags {
  const flags: InkFlags = { ...DEFAULT_INK_FLAGS }
  if (stored) {
    try {
      const obj = JSON.parse(stored) as Record<string, unknown>
      for (const k of Object.keys(PARAMS) as (keyof InkFlags)[]) if (typeof obj[k] === 'boolean') flags[k] = obj[k] as boolean
    } catch {
      // unparseable store → keep defaults, URL overrides still apply
    }
  }
  const qs = new URLSearchParams(search)
  for (const k of Object.keys(PARAMS) as (keyof InkFlags)[]) {
    const v = parseParam(qs.get(PARAMS[k]))
    if (v !== undefined) flags[k] = v
  }
  return flags
}

/** Browser loader (safe when localStorage/location are unavailable). */
export function loadInkFlags(): InkFlags {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(INK_FLAGS_STORAGE_KEY) : null
    const search = typeof location !== 'undefined' ? location.search : ''
    return parseInkFlags(search, stored)
  } catch {
    return { ...DEFAULT_INK_FLAGS }
  }
}

export interface InkFlagsStore {
  /** stable snapshot object (identity changes only on set) — useSyncExternalStore-safe */
  get: () => InkFlags
  /** merge a patch, persist (best-effort) and notify subscribers */
  set: (patch: Partial<InkFlags>) => void
  subscribe: (listener: () => void) => () => void
}

export function createInkFlagsStore(initial: InkFlags, persist?: (flags: InkFlags) => void): InkFlagsStore {
  let current = { ...initial }
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (patch) => {
      current = { ...current, ...patch }
      try {
        persist?.(current)
      } catch {
        // persistence is best-effort; flags stay in memory
      }
      listeners.forEach((l) => l())
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

const persistFlags = (flags: InkFlags) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(INK_FLAGS_STORAGE_KEY, JSON.stringify(flags))
}

/** Module-level store: seeded from localStorage + URL, live-toggled by the debug panel. */
export const inkFlagsStore = createInkFlagsStore(loadInkFlags(), persistFlags)

export const DEBUG_PANEL_PARAM = 'ink-debug'

/** Show the ink debug panel: `?ink-debug=1` forces it on (`=0` hides), else dev builds with any experiment on. */
export function shouldShowDebugPanel(search: string, isDev: boolean, flags: InkFlags): boolean {
  const v = parseParam(new URLSearchParams(search).get(DEBUG_PANEL_PARAM))
  if (v !== undefined) return v
  return isDev && Object.values(flags).some(Boolean)
}
