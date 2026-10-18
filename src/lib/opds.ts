/** OPDS 1.x (Atom) catalogs: parsing, browsing, search and downloading a book from a catalog */

export type Acquisition = { href: string; type: string }
export type OpdsEntry = {
  id: string
  title: string
  author: string
  summary: string
  cover?: string
  /** a sub-catalog (navigation entry): the feed to open */
  nav?: string
  acquisitions: Acquisition[]
}
export type OpdsFeed = {
  title: string
  entries: OpdsEntry[]
  next?: string
  /** an OpenSearch description document, or a ready URL template containing {searchTerms} */
  search?: string
}
export type Catalog = { name: string; url: string }

const DEFAULT_CATALOGS: Catalog[] = [{ name: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks.opds/' }]

/** formats the importer reads, best first for a reflowable reader */
const FORMATS: [RegExp, string][] = [
  [/epub/, 'epub'],
  [/fb2/, 'fb2'],
  [/mobi|kindle/, 'mobi'],
  [/pdf/, 'pdf'],
  [/comicbook|cbz/, 'cbz'],
  [/audio\/(mpeg|mp4|x-m4b|m4a)|m4b/, 'mp3'],
]

const formatOf = (type: string): string | undefined => FORMATS.find(([re]) => re.test(type.toLowerCase()))?.[1]

/** the download of the entry that suits the reader best, if it offers any supported format */
export function pickAcquisition(e: OpdsEntry): (Acquisition & { ext: string }) | undefined {
  let best: (Acquisition & { ext: string }) | undefined
  let bestRank = Infinity
  for (const a of e.acquisitions) {
    const ext = formatOf(a.type)
    const rank = FORMATS.findIndex(([, x]) => x === ext)
    if (ext && rank < bestRank) {
      best = { ...a, ext }
      bestRank = rank
    }
  }
  return best
}

/** only web addresses are followed; anything else (file:, javascript:, data:) is ignored */
export function safeUrl(href: string, base: string): string | undefined {
  try {
    const u = new URL(href, base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? ''
const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name)

/** parse an OPDS 1.x Atom document; relative links are resolved against `base` */
export function parseFeed(xml: string, base: string): OpdsFeed {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (!root || doc.querySelector('parsererror') || root.localName !== 'feed') throw new Error('not an OPDS feed')
  const feed: OpdsFeed = { title: text(kids(root, 'title')[0]), entries: [] }
  for (const l of kids(root, 'link')) {
    const rel = l.getAttribute('rel') ?? ''
    const href = l.getAttribute('href')
    const url = href ? safeUrl(href, base) : undefined
    if (!url) continue
    if (rel === 'next') feed.next = url
    // a template with {searchTerms} is escaped by URL parsing, so keep the raw form for it
    else if (rel === 'search') feed.search = href!.includes('{searchTerms}') ? new URL(href!, base).href.replace(/%7BsearchTerms%7D/i, '{searchTerms}') : url
  }
  for (const e of kids(root, 'entry')) {
    const entry: OpdsEntry = {
      id: text(kids(e, 'id')[0]),
      title: text(kids(e, 'title')[0]),
      author: kids(e, 'author')
        .map((a) => text(kids(a, 'name')[0]))
        .filter(Boolean)
        .join(', '),
      summary: text(kids(e, 'summary')[0]) || text(kids(e, 'content')[0]),
      acquisitions: [],
    }
    for (const l of kids(e, 'link')) {
      const rel = l.getAttribute('rel') ?? ''
      const type = l.getAttribute('type') ?? ''
      const href = l.getAttribute('href')
      const url = href ? safeUrl(href, base) : undefined
      if (!url) continue
      if (rel.startsWith('http://opds-spec.org/acquisition')) entry.acquisitions.push({ href: url, type })
      else if (rel === 'http://opds-spec.org/image/thumbnail' || (rel === 'http://opds-spec.org/image' && !entry.cover)) entry.cover = url
      else if (!rel || rel === 'subsection' || rel === 'alternate' || rel.endsWith('/popular') || rel.endsWith('/new')) {
        if (/atom\+xml/.test(type) && !entry.nav) entry.nav = url
      }
    }
    // a book offered in no supported format is shown, but cannot be added
    feed.entries.push(entry)
  }
  return feed
}

async function get(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`catalog answered ${res.status}`)
  return res
}

export async function fetchFeed(url: string, signal?: AbortSignal): Promise<OpdsFeed> {
  const res = await get(url, signal)
  return parseFeed(await res.text(), res.url || url)
}

/** the search URL for `query`: from a template, or via the catalog's OpenSearch description */
export async function searchUrl(search: string, query: string, signal?: AbortSignal): Promise<string> {
  const fill = (tpl: string) => tpl.replace('{searchTerms}', encodeURIComponent(query))
  if (search.includes('{searchTerms}')) return fill(search)
  const res = await get(search, signal)
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
  const urls = Array.from(doc.getElementsByTagName('Url'))
  const atom = urls.find((u) => /atom\+xml/.test(u.getAttribute('type') ?? '') && u.getAttribute('template'))
  const tpl = atom?.getAttribute('template')
  if (!tpl) throw new Error('catalog has no search')
  // optional OpenSearch parameters such as {startPage?} are left out
  const out = safeUrl(fill(tpl).replace(/\{[^}]*\?\}/g, ''), res.url || search)
  if (!out) throw new Error('catalog has no search')
  return out
}

const fileName = (title: string, ext: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'book'}.${ext}`

/** download the entry's best supported format as a File, ready for the importer */
export async function downloadEntry(e: OpdsEntry, signal?: AbortSignal): Promise<File> {
  const a = pickAcquisition(e)
  if (!a) throw new Error('no supported format')
  const res = await get(a.href, signal)
  return new File([await res.blob()], fileName(e.title, a.ext), { type: a.type })
}

const KEY = 'reader:opdsCatalogs'

export function loadCatalogs(): Catalog[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown
    if (Array.isArray(raw)) {
      return raw.filter(
        (c): c is Catalog => !!c && typeof c.name === 'string' && typeof c.url === 'string' && !!safeUrl(c.url, c.url),
      )
    }
  } catch {
    /* corrupt or unavailable: fall back to the defaults */
  }
  return DEFAULT_CATALOGS
}

export function saveCatalogs(list: Catalog[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: the list is kept for this session only */
  }
}
