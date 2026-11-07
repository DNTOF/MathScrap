import { AI_STORAGE_KEY, emptyAiConfig, normalizeAiConfig, type AiConfig } from './config'

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY)
    if (!raw) return emptyAiConfig()
    return normalizeAiConfig(JSON.parse(raw))
  } catch {
    return emptyAiConfig()
  }
}

export function saveAiConfig(cfg: AiConfig) {
  localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(normalizeAiConfig(cfg)))
}
