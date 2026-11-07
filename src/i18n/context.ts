import { createContext } from 'react'
import type { Lang } from './locale'

export const LocaleContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: 'en',
  setLang: () => undefined,
})
