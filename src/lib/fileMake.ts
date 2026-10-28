// The file's make: how the book's file was produced. The books of one series were mostly made the same way: by the same
// converter or the same digital publisher — the same generator (calibre and its version, a publisher's tool), the same
// style sheet, the same way of naming the files and parts inside it, the same chapter heads ("פרק 1", "1", "אחד"), the same
// fonts embedded. None of it says anything of the name, the story or the copyright page, so it is a direction of its own
// for the cross-check: a clue (`make`) that only agrees, weighed by how rare what the book shares is in the library (a
// converter half the library came out of says nothing of a series).

/** a short hash of a text (FNV-1a, 32 bits), as hex */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** a name's shape: its digits as #, its case lowered ("part0007_split_001.html" → "part#_split_#.html") */
const shape = (s: string) => s.toLowerCase().replace(/\d+/g, '#')

/** the tool a generator or producer line names, with its version ("calibre (5.3.0) [https://…]" → "calibre 5.3.0") */
function tool(s: string): string {
  const t = s
    .toLowerCase()
    .replace(/\[[^\]]*\]|https?:\S+/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length >= 2 && t.length <= 60 ? t : ''
}

/** how a chapter's first line heads it: a word and a number ("פרק 1", "Chapter 1"), a word and a number in words ("פרק
 *  ראשון"), a number alone ("1", "I"), a number in words alone ("אחד"); undefined for anything else */
export function headStyle(line: string): string | undefined {
  const l = line.trim()
  if (/^(?:פרק|chapter|chapitre|kapitel|capítulo|глава)\s+\d{1,3}\.?$/iu.test(l)) return 'word-digit'
  if (/^(?:פרק|chapter|chapitre|kapitel|capítulo|глава)\s+[IVXLC]{1,6}\.?$/iu.test(l)) return 'word-roman'
  if (/^(?:פרק|chapter)\s+\p{L}{2,12}$/iu.test(l)) return 'word-word'
  if (/^\d{1,3}\.?$/u.test(l)) return 'digit'
  if (/^[IVXLC]{1,6}\.?$/u.test(l)) return 'roman'
  if (/^(?:אחד|אחת|שתיים|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|one|two|three|four|five)$/iu.test(l)) return 'word'
  return undefined
}

/** what the file's make is read from: its package, its style sheets, its embedded fonts' file names, its table of
 *  contents (EPUB 2's NCX) and the first line of each chapter */
export interface MakeSource {
  opf: string
  css?: string[]
  fonts?: string[]
  ncx?: string
  heads?: string[]
}

/**
 * The file's make as tokens: `g:` the generator (the package's generator meta, a book producer among its contributors),
 * `c:` each style sheet (a hash of it, its spaces ignored), `f:` each embedded font, `m:` the shape of the names of its
 * parts (its first text file and its id), `t:` the shape of its table of contents' ids and how deep it goes, `h:` how its
 * chapters are headed (when most of them, three at least, are headed one way).
 */
export function makeOf({ opf, css = [], fonts = [], ncx, heads = [] }: MakeSource): string[] {
  const out = new Set<string>()
  for (const m of opf.match(/<(?:opf:)?meta\b[^>]*>/gi) ?? []) {
    if (/\bname\s*=\s*["']generator["']/i.test(m)) {
      const g = tool(/\bcontent\s*=\s*["']([^"']*)["']/i.exec(m)?.[1] ?? '')
      if (g) out.add(`g:${g}`)
    }
  }
  for (const c of opf.matchAll(/<dc:contributor\b([^>]*)>([\s\S]*?)<\/dc:contributor>/gi))
    if (/role\s*=\s*["']bkp["']/i.test(c[1]!) || /calibre|sigil|indesign|pandoc/i.test(c[2]!)) {
      const g = tool(c[2]!.replace(/<[^>]+>/g, ''))
      if (g) out.add(`g:${g}`)
    }
  for (const s of css) {
    const t = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '')
    if (t.length >= 20) out.add(`c:${hash(t)}`)
  }
  for (const f of fonts) {
    const name = f.split('/').pop()?.toLowerCase().replace(/\.[^.]+$/, '')
    if (name) out.add(`f:${name}`)
  }
  const item = (opf.match(/<item\b[^>]*>/gi) ?? []).find((i) => /media-type\s*=\s*["']application\/xhtml/i.test(i))
  if (item) {
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(item)?.[1]
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(item)?.[1]
    if (href) out.add(`m:${shape(href)}|${id ? shape(id) : ''}`)
  }
  if (ncx) {
    const id = /<navPoint\b[^>]*\bid\s*=\s*["']([^"']*)["']/i.exec(ncx)?.[1]
    let depth = 0
    let at = 0
    for (const m of ncx.matchAll(/<(\/?)navPoint\b/gi)) {
      at += m[1] ? -1 : 1
      depth = Math.max(depth, at)
    }
    if (id || depth) out.add(`t:${id ? shape(id) : ''}|${depth}`)
  }
  const styles = heads.map(headStyle)
  const count = new Map<string, number>()
  for (const s of styles) if (s) count.set(s, (count.get(s) ?? 0) + 1)
  const [top] = [...count].sort((x, y) => y[1] - x[1])
  if (top && top[1] >= 3 && top[1] * 2 > styles.length) out.add(`h:${top[0]}`)
  return [...out]
}

/** the make of a PDF: the tools its information names (its producer, its creator) */
export function pdfMake(info: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const k of ['Producer', 'Creator']) {
    const g = typeof info[k] === 'string' ? tool(info[k]) : ''
    if (g) out.add(`g:${g}`)
  }
  return [...out]
}

/**
 * The make's say on a series: the book shares with most of the series' books that say theirs (two at least) what is
 * rare in the library: a token the series' books share, held by few of the library's books (a share `rarity` of them,
 * with eight books at least to know what rare is). One token held by less than a tenth of the library is enough, or two
 * held by less than a third. It only agrees: a series made again by another hand says nothing against.
 */
export function makeVerdict(own: string[], members: string[][], library: string[][]): 'agree' | undefined {
  const told = members.filter((m) => m.length)
  if (told.length < 2 || !own.length) return undefined
  const all = library.filter((m) => m.length)
  if (all.length < 8) return undefined
  let rare = 0
  let rarest = 1
  for (const k of new Set(own)) {
    const share = told.filter((m) => m.includes(k)).length
    if (share < 2 || share * 2 <= told.length) continue
    const freq = all.filter((m) => m.includes(k)).length / all.length
    if (freq >= 1 / 3) continue
    rare++
    rarest = Math.min(rarest, freq)
  }
  return rarest < 0.1 || rare >= 2 ? 'agree' : undefined
}
