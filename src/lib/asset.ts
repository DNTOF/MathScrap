/**
 * URL of a file shipped next to the page (`public/` in dev, `dist/` once packaged).
 * Dev and the native shell both serve the bundle from the origin root, so the
 * default base is `/`. A relative Vite `base` still resolves inside the bundle
 * and never points at a CDN or the Vite dev server.
 */
export function assetUrl(path: string, base?: string): string {
  const root = base ?? readBase()
  const rel = path.replace(/^\/+/, '')
  if (root === './' || root === '.') return `./${rel}`
  const prefix = root.endsWith('/') ? root : `${root}/`
  return `${prefix}${rel}`
}

function readBase(): string {
  const env = import.meta.env
  const configured = env && typeof env.BASE_URL === 'string' ? env.BASE_URL : ''
  return configured || '/'
}
