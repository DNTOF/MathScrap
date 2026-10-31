/**
 * Browser check of every plot path: for each formula case, load a blank sheet, write the formula
 * through `window.mathscrap.tools`, open its coordinate system, and assert that ink really
 * landed on the axes — SVG line/contour points inside the 2D plot area, and coloured pixels
 * in a screenshot of the plot (2D and WebGL 3D alike).
 *
 *   npm run dev            # in another terminal
 *   npm run e2e            # CHROME_PATH / APP_URL / SHOTS can override defaults
 */
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright-core'
import { PNG } from 'pngjs'
import { cases } from './plot-cases'

const URL = (process.env.APP_URL ?? 'http://127.0.0.1:47321/').includes('?') ? process.env.APP_URL! : `${process.env.APP_URL ?? 'http://127.0.0.1:47321/'}?static=1`
const CHROME = process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome'
const SHOTS = process.env.SHOTS ?? '/tmp/mathscrap-e2e'
mkdirSync(SHOTS, { recursive: true })

/** Pixels clearly off the kraft palette: saturated and not in the brown hue band. */
function inkPixels(png: Buffer) {
  const img = PNG.sync.read(png)
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i] / 255
    const g = img.data[i + 1] / 255
    const b = img.data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    if (d < 0.18 || max < 0.12) continue
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = (h * 60 + 360) % 360
    if (h < 16 || h > 55) n++
  }
  return n
}

interface Probe {
  dim: 2 | 3
  traces: number
  linePts: number
  markers: number
  arrows: number
  hasGl: boolean
  ranges: number[]
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const gd = document.querySelector('.js-plotly-plot') as HTMLElement & { data: unknown[]; _fullLayout: any }
    const fl = gd._fullLayout
    const dim = fl.scene ? 3 : 2
    let linePts = 0
    let markers = 0
    if (dim === 2) {
      const { w, h } = fl._size
      gd.querySelectorAll('.scatterlayer .trace path.js-line, .contourlayer path').forEach((p) => {
        const nums = (p.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number) ?? []
        for (let i = 0; i + 1 < nums.length; i += 2) if (nums[i] >= 0 && nums[i] <= w && nums[i + 1] >= 0 && nums[i + 1] <= h) linePts++
      })
      gd.querySelectorAll('.scatterlayer .points path').forEach((m) => {
        const t = (m.getAttribute('transform') ?? '').match(/translate\(([-\d.e]+),\s*([-\d.e]+)\)/)
        if (t && +t[1] >= 0 && +t[1] <= w && +t[2] >= 0 && +t[2] <= h) markers++
      })
    }
    const ranges = dim === 2 ? [...fl.xaxis.range, ...fl.yaxis.range] : [...fl.scene.xaxis.range, ...fl.scene.zaxis.range]
    return { dim, traces: gd.data.length, linePts, markers, arrows: gd.querySelectorAll('.annotation').length, hasGl: !!gd.querySelector('canvas'), ranges } as Probe
  })
}

async function run(viewport: { width: number; height: number }, subset?: number[]) {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.addInitScript(() => localStorage.setItem('mathscrap.doc.v2', JSON.stringify({ strokes: [], cards: [], stickers: [] })))
  const tag = viewport.width < 500 ? 'phone' : 'desktop'
  let failed = 0
  const list = subset ? subset.map((i) => cases[i]) : cases
  for (const [k, [title, text, ex]] of list.entries()) {
    if (ex.error) continue
    errors.length = 0
    const problems: string[] = []
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!(window as any).mathscrap)
    await page.evaluate((t) => {
      const tools = (window as any).mathscrap.tools
      const card = tools.call('page_add_formula', { text: t })
      tools.call('plot_open', { id: card.id })
    }, text)
    try {
      await page.waitForFunction(() => {
        const gd = document.querySelector('.js-plotly-plot') as any
        return gd?._fullLayout && gd.data?.length
      }, null, { timeout: 15000 })
    } catch {
      problems.push('plot never rendered')
    }
    let p: Probe | null = null
    let ink = 0
    if (!problems.length) {
      p = await probe(page)
      await page.waitForTimeout(p.dim === 3 ? 1800 : 500)
      p = await probe(page)
      const box = await page.locator('.js-plotly-plot').boundingBox()
      const png = await page.screenshot({ clip: box! })
      await writeFile(`${SHOTS}/${tag}-${String(k).padStart(2, '0')}.png`, png)
      ink = inkPixels(png)
      if (!p.ranges.every(Number.isFinite)) problems.push(`non-finite axis range ${p.ranges}`)
      if (ex.dim && p.dim !== ex.dim) problems.push(`opened ${p.dim}D, expected ${ex.dim}D`)
      if (p.dim === 2) {
        const curves = p.linePts >= 20
        const geometry = p.markers >= 1 && (p.linePts >= 3 || p.linePts === 0)
        const vectors = p.arrows > 0
        if (!curves && !geometry && !vectors) problems.push(`nothing visible: ${p.linePts} line points, ${p.markers} markers inside the plot area`)
        if ((p.linePts > 0 || vectors) && ink < 150) problems.push(`only ${ink} ink pixels — axes look empty`)
      } else {
        if (!p.hasGl) problems.push('no WebGL canvas')
        if (ink < 300) problems.push(`only ${ink} ink pixels — 3D scene looks empty`)
      }
    }
    if (errors.length) problems.push(`console: ${errors.slice(0, 2).join(' | ')}`)
    if (problems.length) failed++
    const stats = p ? `${p.dim}D traces=${p.traces} line=${p.linePts} visibleMarkers=${p.markers} arrows=${p.arrows} ink=${ink}` : ''
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  [${tag}] ${title.padEnd(18)} ${stats}`)
    problems.forEach((m) => console.log(`        ✗ ${m}`))
  }
  await browser.close()
  return { failed, total: list.filter((c) => !c[2].error).length }
}

const desktop = await run({ width: 1440, height: 900 })
const phone = await run({ width: 390, height: 844 }, [0, 1, 7, 9, 16, 20, 25, 30, 32, 39, 40, 41, 42, 43])
console.log(`\ndesktop ${desktop.total - desktop.failed}/${desktop.total} · phone ${phone.total - phone.failed}/${phone.total} · screenshots in ${SHOTS}`)
process.exit(desktop.failed + phone.failed ? 1 : 0)
