import { ImportError } from './errors'
import type { ExtractedPdf } from './pdfToBook'

const CHAPTER_CHARS = 20000
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')

/** Text of one <w:p>: runs, tabs and line breaks (deleted text lives in w:delText, so it is skipped). */
function paraText(p: Element): string {
  let out = ''
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.namespaceURI !== W) continue
      if (c.localName === 't') out += c.textContent ?? ''
      else if (c.localName === 'tab') out += '\t'
      else if (c.localName === 'br' || c.localName === 'cr') out += ' '
      else walk(c)
    }
  }
  walk(p)
  return out.replace(/\s+/g, ' ').trim()
}

const headingLevel = (p: Element): number => {
  const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? ''
  if (/^title$/i.test(style)) return 1
  const m = /^heading\s*([1-9])$/i.exec(style)
  return m ? Number(m[1]) : 0
}

/** Turn a .docx into the same shape the PDF importer produces, so it goes through buildEpub. */
export async function extractDocx(file: File): Promise<ExtractedPdf> {
  const { default: JSZip } = await import('jszip')
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new ImportError('קובץ ה-DOCX פגום או לא נקרא.')
  }
  const body = await zip.file('word/document.xml')?.async('string')
  if (!body) throw new ImportError('קובץ ה-DOCX פגום או לא נקרא.')
  const doc = xml(body)
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError('קובץ ה-DOCX פגום או לא נקרא.')

  const core = await zip.file('docProps/core.xml')?.async('string')
  const meta = core ? xml(core) : null
  const field = (name: string) => meta?.getElementsByTagNameNS('*', name)[0]?.textContent?.trim() ?? ''
  const title = field('title') || file.name.replace(/\.[^.]+$/, '')
  const author = field('creator')

  const chapters: ExtractedPdf['chapters'] = []
  let cur: string[] = []
  let curTitle = ''
  let size = 0
  const flush = () => {
    if (cur.length) chapters.push({ title: curTitle || `חלק ${chapters.length + 1}`, paras: cur })
    cur = []
    curTitle = ''
    size = 0
  }
  let all = ''
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    const text = paraText(p)
    if (!text) continue
    all += text
    // top-level headings start a new chapter; the rest are kept as ordinary paragraphs
    if (headingLevel(p) === 1) {
      flush()
      curTitle = text
    }
    cur.push(text)
    size += text.length
    if (size >= CHAPTER_CHARS) flush()
  }
  flush()
  if (!chapters.length) throw new ImportError('הקובץ ריק.')
  if (chapters.length === 1 && chapters[0]) chapters[0].title = title

  const letters = all.match(/\p{L}/gu) ?? []
  const hebrew = letters.filter((c) => /[֐-׿]/.test(c)).length
  return { title, author, rtl: hebrew > letters.length / 3, pageCount: 0, chapters }
}
