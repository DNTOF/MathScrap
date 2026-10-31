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

const URL = process.env.APP_URL ?? 'http://127.0.0.1:47321/'
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

await desktop()
await phone()
console.log(problems.length ? `\n${problems.length} problem(s)` : `\nall sheet checks passed · screenshots in ${SHOTS}`)
process.exit(problems.length ? 1 : 0)
