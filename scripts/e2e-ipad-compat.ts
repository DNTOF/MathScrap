/**
 * iPad (iPadOS 15) behaviour in Chromium, against `npm run preview` (or APP_URL):
 *
 * 1. OCR without WASM SIMD. The SIMD probe is forced to fail (as on WebKit before 16.4); the page must
 *    load the non-SIMD compat runtime (`/ort-compat/`, never `/ort/`) and still read handwriting.
 *    `?ocr-compat=1` forces the same path. Without either, the SIMD runtime stays the default.
 * 2. Pen or touch double-taps with the pen tool never open the formula composer; a mouse still does.
 *    Real (CDP) taps in the pen tool produce no synthesised click.
 * 3. Board text selection and the iOS callout are off; the composer textarea can still select.
 *
 * Chromium is not WebKit and has SIMD; this approximates the iPad, it does not replace a device test.
 *
 *   npm run build && npx vite preview &  # 127.0.0.1:47322
 *   npx tsx scripts/e2e-ipad-compat.ts
 */
import { chromium, type Page } from 'playwright-core'
import { resolveBrowser } from './browser-path.ts'
import { inkFixtures } from '../src/ocr/comer/samples.ts'

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:47322/'
const BROWSER = resolveBrowser()
const problems: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!ok) problems.push(what)
}

interface Board {
  left: number
  top: number
  vx: number
  vy: number
  scale: number
}

async function board(page: Page): Promise<Board> {
  return page.evaluate(() => {
    const el = document.querySelector('.kraft-page') as HTMLElement
    const world = [...el.children].find((c) => (c as HTMLElement).style.transform.includes('scale')) as HTMLElement
    const m = new DOMMatrixReadOnly(getComputedStyle(world).transform)
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, vx: m.e, vy: m.f, scale: m.a }
  })
}

async function pageRead(page: Page) {
  return page.evaluate(() => (window as unknown as { mathscrap: { tools: { call: (n: string, a: object) => { formulas: { text: string }[]; strokes: number } } } }).mathscrap.tools.call('page_read', {}))
}

async function open(page: Page, query: string, noSimd: boolean) {
  await page.addInitScript((noSimd) => {
    localStorage.setItem('mathscrap.lang', 'zh')
    localStorage.setItem('mathscrap.prefs.v2', JSON.stringify({ penOnly: false, showGrid: false, showHints: false, autoOcr: false }))
    localStorage.removeItem('mathscrap.doc.v2')
    if (noSimd) {
      // WebKit before 16.4: the 31-byte SIMD probe does not validate. Everything else is untouched.
      const real = WebAssembly.validate.bind(WebAssembly)
      WebAssembly.validate = (bytes: BufferSource) => ((bytes as ArrayBufferView).byteLength === 31 ? false : real(bytes))
    }
  }, noSimd)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}${query}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!(window as unknown as { mathscrap?: unknown }).mathscrap)
  await page.keyboard.press('p')
  return errors
}

/** Draw the y = 2 fixture with the mouse in world coordinates, offset into the sheet. */
async function writeY2(page: Page) {
  const b = await board(page)
  const sample = inkFixtures(3).find((s) => s.name === 'y-eq-2')!
  for (const stroke of sample.strokes) {
    const pts = stroke.points.map((p) => ({ x: b.left + b.vx + (p.x + 120) * b.scale, y: b.top + b.vy + (p.y + 160) * b.scale }))
    await page.mouse.move(pts[0]!.x, pts[0]!.y)
    await page.mouse.down()
    for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(30)
  }
}

async function recognizeRun(page: Page, label: string, expectCompat: boolean) {
  const urls: string[] = []
  page.on('request', (r) => urls.push(new URL(r.url()).pathname))
  await writeY2(page)
  const t0 = Date.now()
  await page.keyboard.press('r')
  await page.waitForFunction(() => document.documentElement.dataset.ocr === 'idle', null, { timeout: 120_000 })
  const ms = Date.now() - t0
  const read = await pageRead(page)
  const texts = read.formulas.map((f) => f.text)
  const simd = urls.some((u) => u.startsWith('/ort/'))
  const compat = urls.some((u) => u.startsWith('/ort-compat/'))
  check(expectCompat ? compat && !simd : simd && !compat, `${label}: runtime ${expectCompat ? 'non-SIMD compat (/ort-compat/, no /ort/)' : 'SIMD (/ort/)'}`)
  check(urls.includes(expectCompat ? '/models/comer/decoder_int8_compat.onnx' : '/models/comer/decoder_int8.onnx'), `${label}: ${expectCompat ? 'Trilu-free' : 'original'} decoder fetched`)
  check(texts.some((t) => /^[yY]\s*=\s*2$/.test(t)), `${label}: handwriting read as y = 2 in ${ms} ms (${texts.join(' | ') || 'nothing'})`)
}

const browser = await chromium.launch({ executablePath: BROWSER.executablePath, headless: true })
try {
  // 1a. no SIMD, detected (no flag)
  {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })
    const errors = await open(page, '', true)
    await recognizeRun(page, 'no-SIMD WebView', true)
    const toast = await page.locator('[data-sonner-toast]').allInnerTexts()
    check(toast.some((t) => t.includes('兼容模式')), 'no-SIMD WebView: one toast explains compatibility mode')
    check(errors.length === 0, `no-SIMD WebView: no page errors (${errors.join('; ')})`)
    await page.close()
  }
  // 1b. dev flag
  {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })
    const errors = await open(page, '?ocr-compat=1', false)
    await recognizeRun(page, '?ocr-compat=1', true)
    check(errors.length === 0, `?ocr-compat=1: no page errors (${errors.join('; ')})`)
    await page.close()
  }
  // 1c. default stays SIMD
  {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })
    const errors = await open(page, '', false)
    await recognizeRun(page, 'SIMD default', false)
    check(errors.length === 0, `SIMD default: no page errors (${errors.join('; ')})`)
    await page.close()
  }
  // 2 + 3. composer, taps, selection
  {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })
    const page = await context.newPage()
    await open(page, '', false)
    const composerOpen = () => page.evaluate(() => document.activeElement instanceof HTMLTextAreaElement)
    const b = await board(page)
    const x = Math.round(b.left + 420)
    const y = Math.round(b.top + 300)
    for (const pointerType of ['touch', 'pen'] as const) {
      await page.evaluate(
        ({ x, y, pointerType }) => {
          const el = document.querySelector('.kraft-page')!
          for (let i = 0; i < 2; i++) {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, pointerType, clientX: x, clientY: y, button: 0, buttons: 1, isPrimary: true }))
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 9, pointerType, clientX: x, clientY: y, button: 0, buttons: 0, isPrimary: true }))
          }
          el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2 }))
        },
        { x, y, pointerType },
      )
      await page.waitForTimeout(150)
      check(!(await composerOpen()), `pen tool: a ${pointerType} double-tap does not open the formula composer`)
    }
    // real touch taps through CDP: the board must cancel them, so no click is synthesised
    await page.evaluate(() => {
      const w = window as unknown as { clicks: number }
      w.clicks = 0
      document.addEventListener('click', () => (w.clicks += 1), true)
    })
    const session = await context.newCDPSession(page)
    for (let i = 0; i < 2; i++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 40, y, id: 3, radiusX: 2, radiusY: 2, force: 0.5 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(400)
    const clicks = await page.evaluate(() => (window as unknown as { clicks: number }).clicks)
    check(clicks === 0, `pen tool: real touch taps on the board synthesise no click (${clicks})`)
    check(!(await composerOpen()), 'pen tool: real touch taps do not open the formula composer')
    const style = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.kraft-page')!) as CSSStyleDeclaration & { webkitUserSelect?: string; webkitTouchCallout?: string }
      return { userSelect: s.userSelect || s.webkitUserSelect, touchAction: s.touchAction }
    })
    check(style.userSelect === 'none' && style.touchAction === 'none', `board: user-select ${style.userSelect}, touch-action ${style.touchAction}`)
    const blocked = await page.evaluate(() => {
      const el = document.querySelector('.kraft-page')!
      const span = document.createElement('span')
      span.textContent = 'text'
      el.appendChild(span)
      const ev = new Event('selectstart', { bubbles: true, cancelable: true })
      span.firstChild!.dispatchEvent(ev)
      span.remove()
      return ev.defaultPrevented
    })
    check(blocked, 'board: selectstart on text inside the board is cancelled')
    // mouse double-click still opens the composer, and its textarea can select
    await page.mouse.dblclick(x, y + 80)
    await page.waitForTimeout(200)
    check(await composerOpen(), 'pen tool: a mouse double-click still opens the composer (desktop unchanged)')
    const fieldOk = await page.evaluate(() => {
      const ta = document.activeElement as HTMLTextAreaElement
      const ev = new Event('selectstart', { bubbles: true, cancelable: true })
      ta.dispatchEvent(ev)
      return !ev.defaultPrevented && getComputedStyle(ta).userSelect !== 'none'
    })
    check(fieldOk, 'composer textarea keeps text selection')
    await session.detach()
    await context.close()
  }
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log('\ne2e ipad-compat ok')
