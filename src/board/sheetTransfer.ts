import { serializeSheet } from './sheetFile'
import type { Doc } from './types'

function suggestedName(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `mathscrap-sheet-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Write the sheet to a place the person picks. Falls back to a browser download. */
export async function exportSheetFile(doc: Doc): Promise<'saved' | 'shared' | 'downloaded' | 'cancelled'> {
  const text = serializeSheet(doc)
  const name = suggestedName()
  if (inTauri()) {
    try {
      const saved = await saveWithDialog(text, name)
      if (saved !== 'unsupported') return saved
    } catch {
      /* the shell refused the folder; try the other two paths */
    }
  }
  const file = new File([text], name, { type: 'application/json' })
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'MathScrap' })
    return 'shared'
  }
  downloadBlob(file, name)
  return 'downloaded'
}

async function saveWithDialog(text: string, name: string): Promise<'saved' | 'cancelled' | 'unsupported'> {
  const dialog = await import('@tauri-apps/plugin-dialog')
  const fs = await import('@tauri-apps/plugin-fs')
  if (typeof dialog.save !== 'function' || typeof fs.writeTextFile !== 'function') return 'unsupported'
  const path = await dialog.save({
    defaultPath: name,
    filters: [{ name: 'MathScrap sheet', extensions: ['json'] }],
  })
  if (path == null) return 'cancelled'
  await fs.writeTextFile(path, text)
  return 'saved'
}

function downloadBlob(file: File, name: string) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export async function readSheetFile(file: File): Promise<string> {
  if (file.size > 8_000_000) throw new Error('文件太大')
  return file.text()
}
