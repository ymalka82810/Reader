import type { Annotation } from './db'

export type ExportFormat = 'markdown' | 'obsidian' | 'pdf'

/** a note with where it sits in the book, ready to be written out */
export type ExportNote = Pick<Annotation, 'kind' | 'text' | 'note' | 'color' | 'createdAt'> & {
  colorName: string
  chapter: string
  /** reading progress at the note, 0..100 */
  percent: number
}

export interface ExportLabels {
  highlights: string
  bookmarks: string
  exportedOn: string
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()
const where = (n: ExportNote) => [n.chapter, `${n.percent}%`].filter(Boolean).join(' · ')
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** file-name safe version of the title */
export const safeFileName = (title: string, fallback: string) => title.replace(/[\\/:*?"<>|]/g, '_').trim() || fallback

/** plain Markdown: a blockquote per highlight, then its location and colour, then the reader's own note */
export function buildMarkdown(title: string, notes: ExportNote[], labels: ExportLabels): string {
  const lines = [`# ${title}`, '']
  const hls = notes.filter((n) => n.kind === 'highlight')
  const marks = notes.filter((n) => n.kind === 'bookmark')
  if (hls.length) {
    lines.push(`## ${labels.highlights}`, '')
    for (const n of hls) {
      lines.push(`> ${oneLine(n.text)}`, '', `— ${where(n)} · ${n.colorName}`)
      if (n.note) lines.push('', n.note)
      lines.push('')
    }
  }
  if (marks.length) lines.push(`## ${labels.bookmarks}`, '', ...marks.map((n) => `- ${oneLine(n.text)}`), '')
  return lines.join('\n')
}

const yamlString = (s: string) => JSON.stringify(s)

/**
 * Obsidian note: YAML properties, one callout per highlight (so it renders as a card), and a `#highlight/<colour>`
 * tag on each so the colours can be searched and filtered in the vault.
 */
export function buildObsidian(title: string, notes: ExportNote[], labels: ExportLabels, now = Date.now()): string {
  const lines = ['---', `title: ${yamlString(title)}`, 'tags: [book-notes]', `exported: ${isoDay(now)}`, '---', '', `# ${title}`, '']
  const hls = notes.filter((n) => n.kind === 'highlight')
  const marks = notes.filter((n) => n.kind === 'bookmark')
  if (hls.length) {
    lines.push(`## ${labels.highlights}`, '')
    for (const n of hls) {
      lines.push(`> [!quote] ${where(n)}`, `> ${oneLine(n.text)}`)
      if (n.note) lines.push('>', ...n.note.split('\n').map((l) => `> ${l}`))
      lines.push('>', `> #highlight/${n.colorName.replace(/\s+/g, '-')}`, '')
    }
  }
  if (marks.length) lines.push(`## ${labels.bookmarks}`, '', ...marks.map((n) => `- ${oneLine(n.text)}`), '')
  return lines.join('\n')
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** printable page; the colour shows as the quote's side border and a swatch. `dir` keeps Hebrew/Arabic books right-to-left. */
export function buildPrintHtml(title: string, notes: ExportNote[], labels: ExportLabels, dir: 'rtl' | 'ltr', now = Date.now()): string {
  const hls = notes.filter((n) => n.kind === 'highlight')
  const marks = notes.filter((n) => n.kind === 'bookmark')
  const items = hls
    .map(
      (n) => `<blockquote style="border-color:${esc(n.color)}"><p>${esc(oneLine(n.text))}</p>` +
        `<small><span class="dot" style="background:${esc(n.color)}"></span>${esc(where(n))} · ${esc(n.colorName)}</small>` +
        (n.note ? `<p class="note">${esc(n.note).replace(/\n/g, '<br>')}</p>` : '') +
        '</blockquote>',
    )
    .join('')
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:14px/1.6 system-ui,sans-serif;margin:2rem;color:#111}
h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:1.6rem}
blockquote{margin:1rem 0;padding:.2rem 1rem;border-inline-start:5px solid;break-inside:avoid}
blockquote p{margin:.4rem 0}small{color:#555;display:flex;align-items:center;gap:.4rem}
.dot{width:.7rem;height:.7rem;border-radius:50%;display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact}
blockquote{-webkit-print-color-adjust:exact;print-color-adjust:exact}.note{background:#f4f4f4;padding:.4rem .6rem;border-radius:4px}
.when{color:#777;font-size:.85rem}
</style></head><body><h1>${esc(title)}</h1><div class="when">${esc(labels.exportedOn)} ${isoDay(now)}</div>` +
    (hls.length ? `<h2>${esc(labels.highlights)}</h2>${items}` : '') +
    (marks.length ? `<h2>${esc(labels.bookmarks)}</h2><ul>${marks.map((n) => `<li>${esc(oneLine(n.text))}</li>`).join('')}</ul>` : '') +
    '</body></html>'
}

/** print `html` through a hidden frame, so the reader can pick "Save as PDF" in the print dialog */
export function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
  frame.srcdoc = html
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.appendChild(frame)
}
