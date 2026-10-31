/**
 * The continuous-sheet flow, driven through the real UI like a person would:
 * blank kraft sheet → write several formulas straight onto the paper → open the corner
 * coordinate-system button → every formula is drawn on the same axes.
 *
 *   npm run dev            # in another terminal
 *   npm run e2e:sheet      # CHROME_PATH / APP_URL / SHOTS can override defaults
 */
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'
import { inkFixtures, shiftInk } from '../src/ocr/comer/samples.ts'
import type { InkStroke } from '../src/ocr/comer/preprocess.ts'

const RAW = process.env.APP_URL ?? 'http://127.0.0.1:47321/'
/** ?static=1 skips the progressive reveal so trace assertions see the finished figure. */
const URL = RAW.includes('?') ? RAW : `${RAW}?static=1`
const CHROME = process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome'
const SHOTS = process.env.SHOTS ?? '/tmp/mathscrap-e2e'
mkdirSync(SHOTS, { recursive: true })

const problems: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!ok) problems.push(what)
}

/** Names of drawn traces and how many 2D line points land inside the plot area. */
async function plotState(page: Page) {
  await page.waitForFunction(() => (document.querySelector('.js-plotly-plot') as any)?._fullLayout, null, { timeout: 15000 })
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const gd = document.querySelector('.js-plotly-plot') as any
    const fl = gd._fullLayout
    const names = (gd.data as { name?: string; type?: string }[]).map((d) => `${d.type ?? 'scatter'}:${d.name ?? ''}`)
    let linePts = 0
    if (!fl.scene) {
      const { w, h } = fl._size
      gd.querySelectorAll('.scatterlayer .trace path.js-line, .contourlayer path').forEach((p: Element) => {
        const n = (p.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
        for (let i = 0; i + 1 < n.length; i += 2) if (n[i] >= 0 && n[i] <= w && n[i + 1] >= 0 && n[i + 1] <= h) linePts++
      })
    }
    return { dim: fl.scene ? 3 : 2, names, linePts }
  })
}

async function write(page: Page, text: string) {
  const ta = page.getByRole('textbox', { name: '在纸上写公式' })
  await ta.waitFor({ state: 'visible' })
  await ta.pressSequentially(text, { delay: 5 })
  await page.keyboard.press('Enter')
  await ta.waitFor({ state: 'detached' })
}

async function desktop() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.removeItem('mathscrap.doc.v2')
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!(window as any).mathscrap)

  check((await page.locator('[data-formula]').count()) === 0, 'desktop: opens on a blank sheet (no formulas)')
  await page.waitForTimeout(600)
  const paperText = await page.evaluate(() => {
    const chrome = '[data-no-board], [aria-hidden], .js-plotly-plot, [data-sonner-toaster]'
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const out: string[] = []
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement!
      const t = n.textContent!.trim()
      if (!t || el.closest(chrome) || el.closest('script,style')) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
      out.push(t)
    }
    return out
  })
  check(!paperText.length, `desktop: blank sheet shows no words on the paper (${paperText.join(' | ')})`)
  const body = await page.evaluate(() => document.body.innerText + document.title)
  check(!/数手账|手账/.test(body) && (await page.title()) === 'MathScrap', `desktop: only the MathScrap name (title "${await page.title()}")`)
  check((await page.locator('.kraft-card, .washi').count()) === 0, 'desktop: no card tiles or washi tape anywhere')
  await page.screenshot({ path: `${SHOTS}/sheet-desktop-blank.png` })

  // three ways to start writing: double-click the paper, "/" and the Σ tool
  await page.mouse.dblclick(420, 260)
  await write(page, 'y = x^2 - 2')
  await page.mouse.dblclick(420, 340)
  await write(page, 'y = 0.5x + 1')
  await page.keyboard.press('/')
  await write(page, 'x^2 + y^2 = 4')
  await page.keyboard.press('t')
  await page.mouse.click(760, 300)
  await write(page, 'x^2 + 2x + 1 = 0')
  await page.mouse.click(760, 420)
  await write(page, 'z = x^2 + y^2')
  await page.keyboard.press('p')

  const n = await page.locator('[data-formula]').count()
  check(n === 5, `desktop: 5 formulas written on the paper (got ${n})`)
  check((await page.locator('.kraft-card, .washi').count()) === 0, 'desktop: formulas render as ink, not cards')
  const badge = await page.getByRole('button', { name: '打开坐标系' }).innerText()
  check(/5/.test(badge), `desktop: corner button counts 5 formulas (${badge.replace(/\s+/g, ' ')})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/sheet-desktop-written.png` })

  await page.getByRole('button', { name: '打开坐标系' }).click()
  let s = await plotState(page)
  const curves = s.names.filter((x) => /^scatter:[fgh]\(x\)$/.test(x)).length
  const contours = s.names.filter((x) => x.startsWith('contour:')).length
  check(s.dim === 2, 'desktop: shared plane coordinate system opens first')
  check(curves === 3 && contours === 1, `desktop: all 4 plane formulas on the same axes (${curves} curves + ${contours} implicit; ${s.names.join(', ')})`)
  check(s.linePts > 200, `desktop: ink on the axes (${s.linePts} line points)`)
  check(await page.getByRole('tab', { name: /平面 · 4/ }).isVisible(), 'desktop: plane / space switch shows 4 · 1')
  await page.screenshot({ path: `${SHOTS}/sheet-desktop-plot2d.png` })

  await page.getByRole('button', { name: 'y = 0.5x + 1' }).first().click()
  s = await plotState(page)
  check(s.names.filter((x) => /^scatter:[fgh]\(x\)$/.test(x)).length === 2, 'desktop: hiding a formula removes it from the shared axes')
  await page.getByRole('button', { name: 'y = 0.5x + 1' }).first().click()

  await page.getByRole('tab', { name: /空间/ }).click()
  s = await plotState(page)
  check(s.dim === 3 && s.names.some((x) => x.startsWith('surface')), 'desktop: space tab shows the surface in 3D')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${SHOTS}/sheet-desktop-plot3d.png` })
  await page.keyboard.press('Escape')

  // edit in place: double-click a formula, rewrite it, the sheet updates
  await page.locator('[data-formula]').first().dblclick()
  const ta = page.getByRole('textbox', { name: '在纸上写公式' })
  await ta.fill('y = x^2 - 3')
  await page.keyboard.press('Enter')
  check(await page.locator('[data-formula]').first().innerText().then((t) => t.includes('3')), 'desktop: double-click rewrites a formula in place')

  await page.keyboard.press('v')
  const f = page.locator('[data-formula]').nth(1)
  const b0 = (await f.boundingBox())!
  await page.mouse.move(b0.x + 10, b0.y + 10)
  await page.mouse.down()
  await page.mouse.move(b0.x + 130, b0.y + 90, { steps: 8 })
  await page.mouse.up()
  const b1 = (await f.boundingBox())!
  check(Math.abs(b1.x - b0.x - 120) < 3 && Math.abs(b1.y - b0.y - 80) < 3, 'desktop: select tool drags a formula across the paper')
  await page.keyboard.press('p')

  await page.reload({ waitUntil: 'networkidle' })
  check((await page.locator('[data-formula]').count()) === 5, 'desktop: the sheet survives a reload')
  check(!errors.length, `desktop: no page errors ${errors.slice(0, 2).join(' | ')}`)
  await browser.close()
}

async function phone() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await page.addInitScript(() => localStorage.removeItem('mathscrap.doc.v2'))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!(window as any).mathscrap)
  await page.screenshot({ path: `${SHOTS}/sheet-phone-blank.png` })

  await page.getByRole('button', { name: '写公式 · 点哪儿写哪儿' }).tap()
  for (const [y, t] of [[220, 'y = sin(x)'], [300, 'y = x/3']] as const) {
    await page.touchscreen.tap(60, y)
    const ta = page.getByRole('textbox', { name: '在纸上写公式' })
    await ta.pressSequentially(t, { delay: 5 })
    await page.getByRole('button', { name: '写上' }).tap()
    await ta.waitFor({ state: 'detached' })
  }
  check((await page.locator('[data-formula]').count()) === 2, 'phone: two formulas written with the Σ tool')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/sheet-phone-written.png` })
  await page.getByRole('button', { name: '打开坐标系' }).tap()
  const s = await plotState(page)
  check(s.names.filter((x) => /^scatter:[fg]\(x\)$/.test(x)).length === 2 && s.linePts > 100, `phone: both curves share one coordinate system (${s.names.join(', ')})`)
  await page.screenshot({ path: `${SHOTS}/sheet-phone-plot.png` })
  await browser.close()
}

/**
 * Round-3 UX: the docked side-by-side pane, live refresh on writing, zoom persistence,
 * the progressive reveal of statements, and the automatic handwriting chip.
 */
async function dockAndLive() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => localStorage.removeItem('mathscrap.doc.v2'))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!(window as any).mathscrap)
  await page.evaluate(() => (window as any).mathscrap.tools.call('page_add_formula', { text: 'y = x^2 - 2' }))

  // 1. the corner button docks the coordinate system beside the paper (not a modal)
  await page.getByRole('button', { name: '打开坐标系' }).click()
  await page.waitForFunction(() => !!document.querySelector('[data-plot-dock] .js-plotly-plot'), null, { timeout: 15000 })
  check(await page.locator('[data-plot-dock]').isVisible(), 'dock: coordinate system docks beside the paper')
  const sheetBox = await page.locator('[data-no-board].kraft-page, .kraft-page').first().boundingBox()
  check(!!sheetBox && sheetBox.width < 1440, `dock: the paper shrinks to make room (width ${Math.round(sheetBox?.width ?? 0)})`)

  // 2. writing on the sheet while docked live-updates the plot
  await page.keyboard.press('/')
  await write(page, 'y = 0.5x + 1')
  let live = false
  for (let i = 0; i < 20 && !live; i++) {
    await page.waitForTimeout(800)
    live = await page.evaluate(() =>
      ((document.querySelector('[data-plot-dock] .js-plotly-plot') as any)?.data?.filter((t: any) => /^[fg]\(x\)$/.test(t.name)).length ?? 0) >= 2,
    )
  }
  if (!live) {
    const dump = await page.evaluate(() => ({
      formulas: document.querySelectorAll('[data-formula]').length,
      dock: !!document.querySelector('[data-plot-dock]'),
      data: ((document.querySelector('[data-plot-dock] .js-plotly-plot') as any)?.data ?? []).map((t: any) => t.name),
      texts: [...document.querySelectorAll('[data-formula]')].map((e) => e.textContent?.slice(0, 40)),
    }))
    console.log('        state:', JSON.stringify(dump))
    await page.screenshot({ path: `${SHOTS}/dock-live-fail.png` })
  }
  check(live, 'dock: writing while docked live-updates the shared axes')

  // 3. wheel zoom inside the pane persists across further writes
  const rangeOf = () => page.evaluate(() => (document.querySelector('[data-plot-dock] .js-plotly-plot') as any)?._fullLayout.xaxis.range ?? [])
  const before = await rangeOf()
  const pane = (await page.locator('[data-plot-dock] .js-plotly-plot').boundingBox())!
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 260)
  await page.keyboard.up('Control')
  await page.waitForTimeout(900)
  const zoomed = await rangeOf()
  check(Math.abs(zoomed[1] - zoomed[0]) > Math.abs(before[1] - before[0]), 'dock: wheel zoom out widens the visible range')
  await page.evaluate(() => (window as any).mathscrap.tools.call('page_add_formula', { text: 'x^2 + y^2 = 4' }))
  await page.waitForTimeout(1600)
  const after = await rangeOf()
  const n = await page.evaluate(() => (document.querySelector('[data-plot-dock] .js-plotly-plot') as any)?.data?.length ?? 0)
  const snapBack = Math.abs(after[1] - after[0] - (before[1] - before[0])) < 1e-6
  check(!snapBack, 'dock: the user zoom survives writing another formula')
  check(n >= 4, `dock: the new formula joins the same axes (${n} traces)`)

  // 4. progressive reveal: without ?static the figure emerges statement by statement
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
  page2.on('pageerror', (e) => errors.push(e.message))
  await page2.addInitScript(() => localStorage.removeItem('mathscrap.doc.v2'))
  await page2.goto(RAW, { waitUntil: 'networkidle' })
  await page2.waitForFunction(() => !!(window as any).mathscrap)
  await page2.evaluate(() => (window as any).mathscrap.tools.call('page_add_formula', { text: 'y = x^2 - 2\ny = 0.5x + 1\nx^2 + y^2 = 4' }))
  await page2.getByRole('button', { name: '打开坐标系' }).click()
  await page2.waitForFunction(() => !!document.querySelector('[data-plot-dock] .js-plotly-plot'), null, { timeout: 15000 })
  const seen: number[] = []
  for (let i = 0; i < 16; i++) {
    const k = await page2.evaluate(() => (document.querySelector('[data-plot-dock] .js-plotly-plot') as any)?.data?.length ?? -1)
    if (seen[seen.length - 1] !== k) seen.push(k)
    await page2.waitForTimeout(170)
  }
  check(seen.length >= 3 && seen[seen.length - 1] >= 3, `reveal: statements emerge one by one (${seen.join(' → ')})`)

  // 5. automatic handwriting chip: settled ink that isn't a formula raises an unknown chip, not a fake equation
  await page2.keyboard.press('p')
  await page2.mouse.move(320, 320)
  await page2.mouse.down()
  await page2.mouse.move(430, 300, { steps: 6 })
  await page2.mouse.move(540, 330, { steps: 6 })
  await page2.mouse.up()
  await page2.mouse.move(330, 370)
  await page2.mouse.down()
  await page2.mouse.move(540, 355, { steps: 8 })
  await page2.mouse.up()
  await page2.waitForSelector('[data-ink-chip][data-ink-ready]', { timeout: 25000 })
  check(true, 'ocr: settled ink raises a recognition chip automatically (default on)')
  const chipText = (await page2.locator('[data-ink-chip]').innerText()).replace(/\s+/g, ' ')
  check(!/1\s*,\s*2\s*,\s*2/.test(chipText) && !chipText.includes('𝐚'), `ocr: chip does not invent a vector triple (${chipText})`)
  check(!/y\s*=\s*x\s*24%/.test(chipText), `ocr: chip does not use the y = x 24% fallback (${chipText})`)
  check((await page2.locator('[data-formula]').count()) === 1, 'ocr: the chip does not write onto the sheet by itself')
  await page2.screenshot({ path: `${SHOTS}/dock-ocr-chip.png` })

  // 6. the on-device CoMER model reads fixture strokes (same points as npm run ocr:live)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page3 = await ctx.newPage()
  page3.on('pageerror', (e) => errors.push(e.message))
  const fixtures = inkFixtures(3).filter((f) => f.name !== 'frac')
  const doc = boardDoc(fixtures.map((f, i) => shiftInk(f.strokes, 120, 160 + i * 460)))
  await page3.addInitScript((saved) => localStorage.setItem('mathscrap.doc.v2', saved), JSON.stringify(doc))
  await page3.goto(RAW, { waitUntil: 'networkidle' })
  await page3.waitForFunction(() => document.querySelectorAll('[data-ink-chip][data-ink-ready]').length >= 3, null, { timeout: 40000 })
  const read = await page3.locator('[data-ink-chip][data-ink-ready]').evaluateAll((els) => els.map((el) => el.getAttribute('data-ink-text') ?? ''))
  check(read.length === 3 && fixtures.every((f) => read.some((t) => f.expect.test(t))), `ocr: model reads y = 2, y = x, a^2 = b (${read.join(' | ')})`)
  check(!read.some((t) => /1,\s*2,\s*2/.test(t)), 'ocr: model does not invent a component triple')
  check((await page3.locator('[data-formula]').count()) === 0, 'ocr: model candidates stay on the chip until accepted')
  await page3.screenshot({ path: `${SHOTS}/ocr-model-chips.png` })
  await ctx.close()

  check(!errors.length, `dock/ocr: no page errors ${errors.slice(0, 2).join(' | ')}`)
  await browser.close()
}

function boardDoc(groups: InkStroke[][]) {
  let n = 0
  return {
    cards: [],
    stickers: [],
    strokes: groups.flat().map((s) => ({
      id: `fix${n++}`,
      pts: s.points.flatMap((p) => [p.x, p.y, 0.5]),
      color: '#2b2118',
      width: s.lineWidth,
      style: 'ink',
      createdAt: n,
    })),
  }
}

if (!process.env.SKIP_BASE) {
  await desktop()
  await phone()
}
await dockAndLive()
console.log(problems.length ? `\n${problems.length} problem(s)` : `\nall sheet checks passed · screenshots in ${SHOTS}`)
process.exit(problems.length ? 1 : 0)
