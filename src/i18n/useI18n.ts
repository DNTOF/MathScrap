import { useContext } from 'react'
import { LocaleContext } from './context'
import { t } from './locale'

export function useI18n() {
  const { lang, setLang } = useContext(LocaleContext)
  return { lang, setLang, t }
}
