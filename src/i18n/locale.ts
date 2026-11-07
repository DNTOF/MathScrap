import { en, zh, type MessageKey } from './messages.ts'

export type Lang = 'zh' | 'en'
export const LANG_KEY = 'mathscrap.lang'

let current: Lang = 'en'

export function getLang(): Lang {
  return current
}

/** Saved choice wins. Otherwise a Chinese browser locale is zh-CN; everything else is English. */
export function resolveLocale(saved: string | null | undefined, navigatorLanguage?: string): Lang {
  if (saved === 'zh' || saved === 'en') return saved
  return navigatorLanguage && /^zh\b/i.test(navigatorLanguage) ? 'zh' : 'en'
}

export function applyLang(lang: Lang) {
  current = lang
  const doc = (globalThis as { document?: { documentElement: { lang: string } } }).document
  if (doc) doc.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text: string = (current === 'zh' ? zh : en)[key]
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

export function readSavedLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY)
  } catch {
    return null
  }
}

export function writeSavedLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* private mode */
  }
}
