// The fonts a PDF made from a book can be written in. Each family comes in its Hebrew, Latin and Latin-extended parts,
// regular and bold (WOFF rather than WOFF2: the PDF writer can only cut a WOFF down to the letters used).
// The uploaded font of the reader (settings) can go first, the family's own letters filling in whatever it lacks.
import heebohebrew400 from '@fontsource/heebo/files/heebo-hebrew-400-normal.woff?url'
import heebohebrew700 from '@fontsource/heebo/files/heebo-hebrew-700-normal.woff?url'
import heebolatin400 from '@fontsource/heebo/files/heebo-latin-400-normal.woff?url'
import heebolatin700 from '@fontsource/heebo/files/heebo-latin-700-normal.woff?url'
import heebolatinext400 from '@fontsource/heebo/files/heebo-latin-ext-400-normal.woff?url'
import heebolatinext700 from '@fontsource/heebo/files/heebo-latin-ext-700-normal.woff?url'
import assistanthebrew400 from '@fontsource/assistant/files/assistant-hebrew-400-normal.woff?url'
import assistanthebrew700 from '@fontsource/assistant/files/assistant-hebrew-700-normal.woff?url'
import assistantlatin400 from '@fontsource/assistant/files/assistant-latin-400-normal.woff?url'
import assistantlatin700 from '@fontsource/assistant/files/assistant-latin-700-normal.woff?url'
import assistantlatinext400 from '@fontsource/assistant/files/assistant-latin-ext-400-normal.woff?url'
import assistantlatinext700 from '@fontsource/assistant/files/assistant-latin-ext-700-normal.woff?url'
import frankhebrew400 from '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-hebrew-400-normal.woff?url'
import frankhebrew700 from '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-hebrew-700-normal.woff?url'
import franklatin400 from '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-latin-400-normal.woff?url'
import franklatin700 from '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-latin-700-normal.woff?url'
import franklatinext400 from '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-latin-ext-400-normal.woff?url'
import franklatinext700 from '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-latin-ext-700-normal.woff?url'
import davidhebrew400 from '@fontsource/david-libre/files/david-libre-hebrew-400-normal.woff?url'
import davidhebrew700 from '@fontsource/david-libre/files/david-libre-hebrew-700-normal.woff?url'
import davidlatin400 from '@fontsource/david-libre/files/david-libre-latin-400-normal.woff?url'
import davidlatin700 from '@fontsource/david-libre/files/david-libre-latin-700-normal.woff?url'
import davidlatinext400 from '@fontsource/david-libre/files/david-libre-latin-ext-400-normal.woff?url'
import davidlatinext700 from '@fontsource/david-libre/files/david-libre-latin-ext-700-normal.woff?url'
import miriamhebrew400 from '@fontsource/miriam-libre/files/miriam-libre-hebrew-400-normal.woff?url'
import miriamhebrew700 from '@fontsource/miriam-libre/files/miriam-libre-hebrew-700-normal.woff?url'
import miriamlatin400 from '@fontsource/miriam-libre/files/miriam-libre-latin-400-normal.woff?url'
import miriamlatin700 from '@fontsource/miriam-libre/files/miriam-libre-latin-700-normal.woff?url'
import miriamlatinext400 from '@fontsource/miriam-libre/files/miriam-libre-latin-ext-400-normal.woff?url'
import miriamlatinext700 from '@fontsource/miriam-libre/files/miriam-libre-latin-ext-700-normal.woff?url'
import { loadCustomFont } from './customFont'
import type { PdfFontKey } from './pdfOptions'

/** each weight's font files, in the order a letter is looked up in them */
interface PdfFontFiles {
  regular: Uint8Array[]
  bold: Uint8Array[]
}

const URLS: Record<Exclude<PdfFontKey, 'custom'>, { regular: string[]; bold: string[] }> = {
  heebo: { regular: [heebohebrew400, heebolatin400, heebolatinext400], bold: [heebohebrew700, heebolatin700, heebolatinext700] },
  assistant: { regular: [assistanthebrew400, assistantlatin400, assistantlatinext400], bold: [assistanthebrew700, assistantlatin700, assistantlatinext700] },
  frank: { regular: [frankhebrew400, franklatin400, franklatinext400], bold: [frankhebrew700, franklatin700, franklatinext700] },
  david: { regular: [davidhebrew400, davidlatin400, davidlatinext400], bold: [davidhebrew700, davidlatin700, davidlatinext700] },
  miriam: { regular: [miriamhebrew400, miriamlatin400, miriamlatinext400], bold: [miriamhebrew700, miriamlatin700, miriamlatinext700] },
}

const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer())

const fromDataUrl = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))

/** a font file the PDF writer can embed: TrueType, OpenType or WOFF */
const writable = (b: Uint8Array) => {
  const tag = String.fromCharCode(...b.slice(0, 4))
  return tag === 'wOFF' || tag === 'OTTO' || tag === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)
}

/** the files of `key`'s family; for 'custom', the uploaded font first (regular and bold alike), then Heebo for the rest */
export async function loadPdfFonts(key: PdfFontKey = 'heebo'): Promise<PdfFontFiles> {
  const custom = key === 'custom' ? await loadCustomFont() : undefined
  const urls = URLS[key === 'custom' ? 'heebo' : key]
  const [regular, bold] = await Promise.all([Promise.all(urls.regular.map(bytes)), Promise.all(urls.bold.map(bytes))])
  if (!custom) return { regular, bold }
  const own = fromDataUrl(custom.dataUrl)
  // WOFF2 (and anything unknown) cannot be cut down by the PDF writer: Heebo alone then
  if (!writable(own)) return { regular, bold }
  return { regular: [own, ...regular], bold: [own, ...bold] }
}
