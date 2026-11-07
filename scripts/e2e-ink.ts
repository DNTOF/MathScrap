/**
 * Write → partial erase → undo/redo → keep writing, including cancelled pointers.
 *
 *   npm run dev
 *   npm run e2e:ink
 *
 * Pointers here are dispatched by Playwright (mouse) or by synthetic PointerEvents
 * (pen, touch, cancel, lost capture). That is not a physical stylus, palm, or device.
 */
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'
import { resolveBrowser } from './browser-path.ts'

const URL = process.env.APP_URL ?? 'http://127.0.0.1:47321/'
const BROWSER = resolveBrowser()
console.log(`browser ${BROWSER.executablePath} (${BROWSER.via})`)
const SHOTS = process.env.SHOTS ?? '/tmp/mathscrap-e2e'
mkdirSync(SHOTS, { recursive: true })

const problems: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!ok) problems.push(what)
}

interface InkState {
  total: number
  paths: number
  scale: number
  vx: number
  vy: number
  left: number
  top: number
  strokes: { pts: number[] }[]
}

async function ink(page: Page): Promise<InkState> {
  return page.evaluate(() => {
    const read = (window as unknown as { mathscrap: { tools: { call: (n: string, a: object) => InkState } } }).mathscrap.tools.call('ink_read', {})
    const board = document.querySelector('.kraft-page') as HTMLElement
    const world = [...board.children].find((c) => (c as HTMLElement).style.transform.includes('scale')) as HTMLElement
    const m = new DOMMatrixReadOnly(getComputedStyle(world).transform)
    const rect = board.getBoundingClientRect()
    return {
      total: read.total,
      strokes: read.strokes,
      paths: board.querySelectorAll('svg[data-ink] path').length,
      scale: m.a,
      vx: m.e,
      vy: m.f,
      left: rect.left,
      top: rect.top,
    }
  })
}

function worldToClient(s: InkState, x: number, y: number) {
  return { x: s.left + s.vx + x * s.scale, y: s.top + s.vy + y * s.scale }
}

async function raw(page: Page, phase: 'down' | 'move' | 'up' | 'cancel' | 'lost', x: number, y: number, pointerId: number, pointerType: 'mouse' | 'pen' | 'touch') {
  await page.evaluate(
    ({ phase, x, y, pointerId, pointerType }) => {
      const el = document.querySelector('.kraft-page')!
      const name = phase === 'down' ? 'pointerdown' : phase === 'move' ? 'pointermove' : phase === 'up' ? 'pointerup' : phase === 'cancel' ? 'pointercancel' : 'lostpointercapture'
      el.dispatchEvent(
        new PointerEvent(name, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: phase === 'up' || phase === 'cancel' ? 0 : 1,
          pressure: pointerType === 'pen' ? 0.55 : 0.5,
          isPrimary: true,
        }),
      )
    },
    { phase, x, y, pointerId, pointerType },
  )
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('mathscrap.lang', 'zh')
    localStorage.setItem('mathscrap.prefs.v2', JSON.stringify({ penOnly: false, showGrid: false, showHints: false, autoOcr: false }))
    localStorage.removeItem('mathscrap.doc.v2')
  })
}

async function boot(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!(window as unknown as { mathscrap?: unknown }).mathscrap)
  await page.keyboard.press('p')
  return errors
}

/** A short stroke near the middle of the sheet. Returns when it has been committed. */
async function drawMouse(page: Page, x: number, y: number) {
  await page.keyboard.press('p')
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + i * 16, y + Math.sin(i) * 8)
  await page.mouse.up()
  await page.waitForTimeout(40)
}

async function cdp(page: Page) {
  return page.context().newCDPSession(page)
}

/** Two real touch contacts. The second finger has to drop the unfinished stroke instead of leaving it on the paper. */
async function twoFinger(page: Page, label: string) {
  const before = await ink(page)
  const x = Math.round(before.left + before.vx + 160)
  const y = Math.round(before.top + 200)
  const session = await cdp(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x, y, id: 1, radiusX: 4, radiusY: 4, force: 0.5 },
      { x: x + 100, y: y + 12, id: 2, radiusX: 4, radiusY: 4, force: 0.5 },
    ],
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
  const s = await ink(page)
  check(s.total === before.total && s.paths === s.total, `${label}: a second real touch drops the unfinished stroke and leaves no ghost`)
}

/**
 * Trusted pen events, then a trusted touch while the pen is still down.
 * Synthetic PointerEvents never enter the browser's capture and hit-testing path.
 */
async function penPlusPalm(page: Page, label: string) {
  const before = await ink(page)
  const x = Math.round(before.left + 220)
  const y = Math.round(before.top + 210)
  const session = await cdp(page)
  const pen = async (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', px: number, py: number) => {
    await session.send('Input.dispatchMouseEvent', {
      type,
      x: px,
      y: py,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'pen',
      force: 0.6,
    })
  }
  await pen('mousePressed', x, y)
  await pen('mouseMoved', x + 80, y + 6)
  const captured = await page.evaluate(() => {
    const el = document.querySelector('.kraft-page') as HTMLElement
    for (let id = 1; id <= 32; id++) if (el.hasPointerCapture(id)) return true
    return false
  })
  check(captured, `${label}: the pen down takes pointer capture`)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x + 30, y: y + 110, id: 7, radiusX: 10, radiusY: 10, force: 0.3 }],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 30, y: y + 150, id: 7, radiusX: 10, radiusY: 10, force: 0.3 }],
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await pen('mouseMoved', x + 150, y + 10)
  await pen('mouseReleased', x + 150, y + 10)
  await session.detach()
  const s = await ink(page)
  const stroke = s.strokes[s.strokes.length - 1]
  const ys: number[] = []
  if (stroke) for (let i = 1; i < stroke.pts.length; i += 3) ys.push(stroke.pts[i])
  const span = ys.length ? Math.max(...ys) - Math.min(...ys) : Infinity
  check(s.total === before.total + 1 && s.paths === s.total, `${label}: a palm touch does not swallow or ghost the pen stroke`)
  check(span < 40, `${label}: the palm does not pull the pen stroke (${span.toFixed(1)} world px tall)`)
  check(Math.abs(s.vx - before.vx) < 1 && Math.abs(s.vy - before.vy) < 1 && Math.abs(s.scale - before.scale) < 0.001, `${label}: the palm does not pan the sheet`)
}

/** Real mouse capture: release over a toolbar button, which sits outside the sheet hit target. */
async function releaseOverToolbar(page: Page, label: string) {
  const before = (await ink(page)).total
  const board = await page.locator('.kraft-page').boundingBox()
  const eraser = await page.locator('[aria-label="橡皮（整笔擦除）"]').boundingBox()
  if (!board || !eraser) throw new Error('board or eraser missing')
  const x = Math.round(board.x + board.width * 0.32)
  const y = Math.round(board.y + Math.min(220, board.height * 0.35))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(eraser.x + eraser.width / 2, eraser.y + eraser.height / 2, { steps: 6 })
  await page.mouse.up()
  const s = await ink(page)
  const penPressed = await page.locator('[aria-label="笔"]').getAttribute('aria-pressed')
  check(s.total === before + 1 && s.paths === s.total, `${label}: releasing the mouse over the toolbar still commits the stroke`)
  check(penPressed === 'true', `${label}: that release does not activate the button under the cursor`)
}

async function gestureLoop(page: Page, label: string) {
  await twoFinger(page, label)
  await penPlusPalm(page, label)
  await releaseOverToolbar(page, label)
  const origin = await ink(page)
  const x = Math.round(origin.left + origin.vx + 180)
  const y = Math.round(origin.top + 220)
  await drawMouse(page, x, y)
  let s = await ink(page)
  check(s.total === origin.total + 1, `${label}: mouse stroke commits`)

  await page.keyboard.press('Control+z')
  s = await ink(page)
  check(s.total === origin.total, `${label}: undo removes that stroke`)
  await page.keyboard.press('Control+Shift+z')
  s = await ink(page)
  check(s.total === origin.total + 1, `${label}: redo puts it back`)

  const before = (await ink(page)).total
  await page.mouse.move(x, y + 70)
  await page.mouse.down()
  await page.mouse.move(x + 90, y + 90)
  await raw(page, 'cancel', x + 90, y + 90, 1, 'mouse')
  await page.mouse.up()
  s = await ink(page)
  check(s.total === before && s.paths === before, `${label}: mouse pointercancel leaves no stroke and no ghost path`)

  for (const kind of ['touch', 'pen'] as const) {
    const n = (await ink(page)).total
    const id = kind === 'pen' ? 7 : 8
    await raw(page, 'down', x + 20, y + 120, id, kind)
    await raw(page, 'move', x + 80, y + 140, id, kind)
    await raw(page, 'cancel', x + 80, y + 140, id, kind)
    s = await ink(page)
    check(s.total === n && s.paths === n, `${label}: ${kind} pointercancel leaves no stroke`)
  }

  {
    const n = (await ink(page)).total
    await raw(page, 'down', x + 30, y + 160, 9, 'pen')
    await raw(page, 'move', x + 100, y + 170, 9, 'pen')
    await raw(page, 'lost', x + 100, y + 170, 9, 'pen')
    await raw(page, 'move', x + 130, y + 180, 9, 'pen')
    s = await ink(page)
    check(s.total === n && s.paths === n, `${label}: lost pointer capture drops the stroke and ignores later moves`)
  }

  {
    const n = (await ink(page)).total
    await page.mouse.move(x, y + 200)
    await page.mouse.down()
    await page.mouse.move(x + 70, y + 210)
    await page.keyboard.press('e')
    await page.waitForFunction(() => document.querySelector('[aria-label="橡皮（整笔擦除）"]')?.getAttribute('aria-pressed') === 'true')
    await page.mouse.up()
    s = await ink(page)
    check(s.total === n && s.paths === n, `${label}: switching tool mid-stroke does not commit it`)
    await page.keyboard.press('p')
  }

  {
    const n = (await ink(page)).total
    await page.mouse.move(x + 10, y + 240)
    await page.mouse.down()
    await page.mouse.move(x + 80, y + 250)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()
    s = await ink(page)
    check(s.total === n && s.paths === n, `${label}: blur aborts the in-progress stroke`)
  }

  await drawMouse(page, x, y + 280)
  s = await ink(page)
  check(s.total === before + 1, `${label}: a later stroke still commits after the interruptions`)
}

async function eraseAtZoom(page: Page, label: string) {
  await page.keyboard.press('p')
  const board = await page.locator('.kraft-page').boundingBox()
  if (!board) throw new Error('board missing')
  // A band above the earlier samples and still on screen after the menu zoom.
  const x = Math.round(board.x + board.width * 0.34)
  const y = Math.round(board.y + 140)
  await drawMouse(page, x, y)
  let s = await ink(page)
  const stroke = s.strokes[s.strokes.length - 1]
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < stroke.pts.length; i += 3) {
    xs.push(stroke.pts[i])
    ys.push(stroke.pts[i + 1])
  }
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const midY = ys[Math.floor(ys.length / 2)]

  // The pen-detected toast sits on top of the menu on a narrow viewport and stays while the pointer hovers it.
  await settleToasts(page)
  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('button', { name: '放大' }).click()
  await page.keyboard.press('Escape')
  s = await ink(page)
  check(s.scale > 1, `${label}: zoom in changes the view scale (${s.scale.toFixed(3)})`)

  // Endpoints sit well outside the stroke. Only the segment between them crosses it.
  const farL = worldToClient(s, minX - 80, midY)
  const farR = worldToClient(s, maxX + 80, midY)
  await page.keyboard.press('e')
  await page.mouse.move(farL.x, farL.y)
  await page.mouse.down()
  await page.mouse.move(farR.x, farR.y)
  await page.mouse.up()
  const after = await ink(page)
  check(after.total === s.total - 1, `${label}: one eraser swipe across the stroke at zoom ${s.scale.toFixed(2)} removes it`)

  await page.keyboard.press('Control+z')
  check((await ink(page)).total === s.total, `${label}: undo restores the erased stroke`)
  await page.keyboard.press('Control+Shift+z')
  check((await ink(page)).total === s.total - 1, `${label}: redo removes it again`)

  // A miss must not consume the undo slot that brings the stroke back.
  const miss = worldToClient(await ink(page), minX - 160, midY - 160)
  await page.mouse.move(miss.x, miss.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.press('Control+z')
  check((await ink(page)).total === s.total, `${label}: an eraser miss does not take an undo step`)
  await page.keyboard.press('p')
}

/** Move off a toast so it is not paused by hover, then wait until it leaves. Do not edit the toaster DOM. */
async function settleToasts(page: Page) {
  await page.mouse.move(6, 420)
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'), null, { timeout: 8000 }).catch(() => undefined)
}

async function formulaHistory(page: Page, label: string) {
  await page.keyboard.press('v')
  await page.keyboard.press('/')
  const ta = page.getByRole('textbox', { name: '在纸上写公式' })
  await ta.waitFor({ state: 'visible' })
  await ta.fill('y = x')
  await page.keyboard.press('Enter')
  await ta.waitFor({ state: 'detached' })
  const formula = page.locator('[data-formula]')
  await formula.click()
  const selected = async () => (await formula.locator('.ink-formula').getAttribute('class'))?.includes('border-dashed') ?? false
  check(await selected(), `${label}: clicking a formula selects it`)
  const start = await formula.getAttribute('style')
  await page.keyboard.press('Delete')
  check((await formula.count()) === 0, `${label}: delete removes the formula`)
  await settleToasts(page)
  await page.keyboard.press('Control+z')
  await formula.waitFor()
  check((await formula.count()) === 1 && (await selected()), `${label}: undo restores the formula and its selection`)

  await page.keyboard.press('v')
  await settleToasts(page)
  const box = await formula.boundingBox()
  if (!box) throw new Error('formula box missing')
  const px = box.x + 24
  const py = box.y + 16
  await page.mouse.move(px, py)
  await page.mouse.down()
  await page.mouse.move(px + 36, py + 28)
  await page.mouse.move(px, py)
  await page.mouse.up()
  await page.keyboard.press('Control+z')
  check((await formula.count()) === 0, `${label}: dragging a formula back to its start does not add an undo step`)

  await settleToasts(page)
  await page.keyboard.press('Control+Shift+z')
  await formula.waitFor()
  check((await formula.count()) === 1, `${label}: redo brings the formula back`)
  await settleToasts(page)
  const again = await formula.boundingBox()
  if (!again) throw new Error('formula box missing after redo')
  await page.mouse.move(again.x + 24, again.y + 16)
  await page.mouse.down()
  await page.mouse.move(again.x + 70, again.y + 40)
  await page.evaluate(() => {
    const el = document.querySelector('[data-formula]')!
    el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, button: 0, buttons: 0, isPrimary: true }))
  })
  await page.mouse.up()
  const style = await formula.getAttribute('style')
  check(style === start, `${label}: pointercancel rolls a formula drag back (${style} vs ${start})`)
  await page.keyboard.press('Control+z')
  check((await formula.count()) === 0, `${label}: a cancelled drag is not an undo step`)
}

async function run(viewport: { width: number; height: number }, dpr: number, label: string, shot: string) {
  const browser = await chromium.launch({ executablePath: BROWSER.executablePath, args: ['--no-sandbox', '--use-gl=swiftshader'] })
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr })
  await seed(page)
  const errors = await boot(page)
  await gestureLoop(page, label)
  await eraseAtZoom(page, label)
  await formulaHistory(page, label)
  if (label === 'desktop') {
    await page.keyboard.press('p')
    await page.locator('[aria-label="把手写收成公式"]').click()
    const ocr = await page.evaluate(() => document.documentElement.dataset.ocr ?? '')
    check(ocr === 'run' || ocr === 'idle', `desktop: the recognize button starts a reading (${ocr || 'unset'})`)
  }
  check(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`)
  await page.screenshot({ path: `${SHOTS}/${shot}.png` })
  await browser.close()
}

await run({ width: 1440, height: 900 }, 1, 'desktop', 'ink-desktop')
await run({ width: 390, height: 844 }, 1, 'phone', 'ink-phone')
await run({ width: 1280, height: 800 }, 2, 'dpr2', 'ink-dpr2')

if (problems.length) {
  console.log(`\n${problems.length} failed`)
  process.exit(1)
}
console.log('\nink e2e passed')
