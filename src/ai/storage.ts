import { AI_STORAGE_KEY, emptyAiConfig, normalizeAiConfig, type AiConfig } from './config'

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY)
    if (!raw) return emptyAiConfig()
    const cfg = normalizeAiConfig(JSON.parse(raw))
    if (cfg.apiKey) localStorage.setItem(AI_STORAGE_KEY, JSON.stringify({ ...cfg, apiKey: '' }))
    return { ...cfg, apiKey: '' }
  } catch {
    return emptyAiConfig()
  }
}

export function saveAiConfig(cfg: AiConfig) {
  const stored = normalizeAiConfig(cfg)
  localStorage.setItem(AI_STORAGE_KEY, JSON.stringify({ ...stored, apiKey: '' }))
}
