import { t } from '../i18n'
import { createStore, del, get, set } from 'idb-keyval'

export const CUSTOM_FONT_FAMILY = 'ReaderCustomFont'
const MAX_FONT_BYTES = 8 * 1024 * 1024

export interface CustomFont {
  name: string
  /** the font file as a data: URL, ready for @font-face (works inside the book's iframe) */
  dataUrl: string
}

const store = createStore('reader-font-db', 'font')
const KEY = 'custom'

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

export const loadCustomFont = () => get<CustomFont>(KEY, store).catch(() => undefined)

export const removeCustomFont = () => del(KEY, store)

/** stores an uploaded font file; rejects anything that is not a font or is too big */
export async function saveCustomFont(file: File): Promise<CustomFont> {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error(t('font.badType'))
  if (file.size > MAX_FONT_BYTES) throw new Error(t('font.tooBig'))
  const font = { name: file.name.replace(/\.[^.]+$/, ''), dataUrl: await readAsDataUrl(file) }
  await set(KEY, font, store)
  return font
}

/** @font-face rule for the uploaded font */
export const customFontFace = (f: CustomFont) =>
  `@font-face { font-family: "${CUSTOM_FONT_FAMILY}"; src: url("${f.dataUrl}"); font-display: swap; }`
