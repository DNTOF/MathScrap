/** Plot commands issued by the local tool bridge. PlotPane applies them when it is mounted. */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Camera3 {
  eye?: Vec3
  center?: Vec3
  up?: Vec3
}

export interface PlotViewInput {
  x?: [number, number]
  y?: [number, number]
  z?: [number, number]
  camera?: Camera3
  mode?: 2 | 3
  show?: string[]
  hide?: string[]
  only?: string[]
  fit?: boolean
}

export interface PlotViewCommand extends PlotViewInput {
  seq: number
}

export function normalizePlotInput(raw: Record<string, unknown>): { ok: true; value: PlotViewInput } | { ok: false; error: string } {
  const value: PlotViewInput = {}
  const x = pair(raw.x)
  const y = pair(raw.y)
  const z = pair(raw.z)
  if (x === 'bad') return { ok: false, error: 'x 需要是 [min, max] 两个不同的数' }
  if (y === 'bad') return { ok: false, error: 'y 需要是 [min, max] 两个不同的数' }
  if (z === 'bad') return { ok: false, error: 'z 需要是 [min, max] 两个不同的数' }
  if ((x && !y) || (!x && y)) return { ok: false, error: 'x 和 y 范围要一起给' }
  if (x && y) {
    value.x = x
    value.y = y
  }
  if (z) value.z = z
  if (raw.camera != null) {
    const camera = cameraOf(raw.camera)
    if (!camera) return { ok: false, error: 'camera.eye / center / up 需要是 {x, y, z}' }
    value.camera = camera
  }
  if (raw.mode != null && raw.mode !== '') {
    const mode = Number(raw.mode)
    if (mode !== 2 && mode !== 3) return { ok: false, error: 'mode 只能是 2（平面）或 3（空间）' }
    value.mode = mode
  }
  const only = ids(raw.only)
  const show = ids(raw.show)
  const hide = ids(raw.hide)
  if (only === 'bad' || show === 'bad' || hide === 'bad') return { ok: false, error: 'only / show / hide 需要是公式 id 数组' }
  if (only) value.only = only
  if (show) value.show = show
  if (hide) value.hide = hide
  if (raw.fit === true || raw.fit === 'true') value.fit = true
  if (!value.x && !value.z && !value.camera && !value.mode && !value.only && !value.show && !value.hide && !value.fit) {
    return { ok: false, error: '需要 x/y 范围、z、camera、mode、only/show/hide 或 fit' }
  }
  return { ok: true, value }
}

function pair(v: unknown): [number, number] | undefined | 'bad' {
  if (v == null || v === '') return undefined
  if (!Array.isArray(v) || v.length < 2) return 'bad'
  const a = Number(v[0])
  const b = Number(v[1])
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 'bad'
  return a < b ? [a, b] : [b, a]
}

function ids(v: unknown): string[] | undefined | 'bad' {
  if (v == null) return undefined
  if (!Array.isArray(v)) return 'bad'
  const out = v.map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : '')).filter(Boolean)
  return out.length ? out : undefined
}

function vec3(v: unknown): Vec3 | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const x = Number(o.x)
  const y = Number(o.y)
  const z = Number(o.z)
  if (![x, y, z].every(Number.isFinite)) return undefined
  return { x, y, z }
}

function cameraOf(v: unknown): Camera3 | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const camera: Camera3 = {}
  if (o.eye != null) {
    const eye = vec3(o.eye)
    if (!eye) return undefined
    camera.eye = eye
  }
  if (o.center != null) {
    const center = vec3(o.center)
    if (!center) return undefined
    camera.center = center
  }
  if (o.up != null) {
    const up = vec3(o.up)
    if (!up) return undefined
    camera.up = up
  }
  return camera.eye || camera.center || camera.up ? camera : undefined
}

let seq = 0
let current: PlotViewCommand | null = null
let taken = 0
const listeners = new Set<(cmd: PlotViewCommand) => void>()

export function pushPlotView(input: PlotViewInput): PlotViewCommand {
  const cmd: PlotViewCommand = { ...input, seq: ++seq }
  current = cmd
  if (listeners.size) {
    taken = cmd.seq
    for (const listener of listeners) listener(cmd)
  }
  return cmd
}

/** A command stored before any pane was listening. Mounting the pane consumes it once. */
export function takePlotView(): PlotViewCommand | null {
  if (!current || current.seq === taken) return null
  taken = current.seq
  return current
}

export function subscribePlotView(listener: (cmd: PlotViewCommand) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
