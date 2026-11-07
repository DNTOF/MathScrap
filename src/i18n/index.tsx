import { useState, type ReactNode } from 'react'
import { applyLang, readSavedLang, resolveLocale, writeSavedLang, type Lang } from './locale'
import { LocaleContext } from './context'

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = resolveLocale(readSavedLang(), typeof navigator !== 'undefined' ? navigator.language : undefined)
    applyLang(initial)
    return initial
  })
  const setLang = (next: Lang) => {
    applyLang(next)
    writeSavedLang(next)
    setLangState(next)
  }
  return <LocaleContext.Provider value={{ lang, setLang }}>{children}</LocaleContext.Provider>
}
