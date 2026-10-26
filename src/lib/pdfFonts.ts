// The fonts a PDF made from a book is written in: Heebo, the app's own font, in its Hebrew, Latin and Latin-extended
// parts, regular and bold. WOFF rather than WOFF2: the PDF writer can only cut a WOFF down to the letters used.
import he400 from '@fontsource/heebo/files/heebo-hebrew-400-normal.woff?url'
import he700 from '@fontsource/heebo/files/heebo-hebrew-700-normal.woff?url'
import la400 from '@fontsource/heebo/files/heebo-latin-400-normal.woff?url'
import la700 from '@fontsource/heebo/files/heebo-latin-700-normal.woff?url'
import lx400 from '@fontsource/heebo/files/heebo-latin-ext-400-normal.woff?url'
import lx700 from '@fontsource/heebo/files/heebo-latin-ext-700-normal.woff?url'

/** each weight's font files, in the order a letter is looked up in them */
export interface PdfFontFiles {
  regular: Uint8Array[]
  bold: Uint8Array[]
}

const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer())

export async function loadPdfFonts(): Promise<PdfFontFiles> {
  const [regular, bold] = await Promise.all([
    Promise.all([he400, la400, lx400].map(bytes)),
    Promise.all([he700, la700, lx700].map(bytes)),
  ])
  return { regular, bold }
}
