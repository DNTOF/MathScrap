import { t } from '../i18n/locale.ts'

/** Browser-local AI settings. The API key never leaves this shape except as a request header. */
export type AiProvider = 'openai-compatible' | 'anthropic' | 'local'

export interface AiConfig {
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
}

export const AI_STORAGE_KEY = 'mathscrap.ai.v1'

export function emptyAiConfig(): AiConfig {
  return { provider: 'openai-compatible', baseUrl: '', model: '', apiKey: '' }
}

export function normalizeProvider(value: unknown): AiProvider {
  if (value === 'anthropic' || value === 'local' || value === 'openai-compatible') return value
  return 'openai-compatible'
}

export function normalizeAiConfig(raw: unknown): AiConfig {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    provider: normalizeProvider(src.provider),
    baseUrl: typeof src.baseUrl === 'string' ? src.baseUrl : '',
    model: typeof src.model === 'string' ? src.model : '',
    apiKey: typeof src.apiKey === 'string' ? src.apiKey : '',
  }
}

/**
 * Why the form cannot call the network yet. Empty config returns immediately —
 * callers must not open a request, spinner, or timeout.
 */
export function missingConfig(cfg: AiConfig): string | null {
  const model = cfg.model.trim()
  const base = cfg.baseUrl.trim()
  const key = cfg.apiKey.trim()
  if (cfg.provider === 'anthropic') {
    if (!model && !key) return t('needModelAndKey')
    if (!model) return t('needModel')
    if (!key) return t('needKey')
    return null
  }
  if (!base && !model) return t('needBaseAndModel')
  if (!base) return t('needBase')
  if (!model) return t('needModel')
  return null
}

/** Base URL actually requested. Local and OpenAI-compatible hosts get `/v1` when the path is empty. */
export function resolveBaseUrl(cfg: AiConfig): string {
  const trimmed = cfg.baseUrl.trim()
  if (!trimmed) return cfg.provider === 'anthropic' ? 'https://api.anthropic.com' : ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(t('badBase'))
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(t('badProtocol'))
  url.username = ''
  url.password = ''
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/+$/, '')
  if (cfg.provider !== 'anthropic' && (path === '' || path === '/')) path = '/v1'
  url.pathname = path || '/'
  return url.toString().replace(/\/+$/, '')
}

export function joinUrl(base: string, path: string): string {
  const root = base.replace(/\/+$/, '')
  let rest = path.replace(/^\/+/, '')
  if (root.endsWith('/v1') && (rest === 'v1' || rest.startsWith('v1/'))) rest = rest.replace(/^v1\/?/, '')
  return rest ? `${root}/${rest}` : root
}
