// The same book several times in the phone's folders, found from the files' names (a book's own name, its format and
// a " (2)" a download adds aside): per format one copy is kept (the one the library follows, then the one in the books
// folder, then the biggest); the EPUB is the book's main file, the other formats are versions that belong in the author's
// "גרסאות" folder, and a second copy of a format is surplus, offered for deleting. Nothing here touches a file.
import type { DeviceFile } from './deviceBooks'
import { isJunkTitle, splitBookName } from './bookName'
import { norm, sameBook } from './sameBook'

/** the app's own books folder on the phone (the native plugin's LIBRARY_DIR) */
const LIBRARY_DIR_NAME = 'קורא ספרים'
/** the sub-folder of an author's folder that holds the book's other formats */
export const VERSIONS_DIR_NAME = 'גרסאות'

/** what a file is as a book: its title and author, as the app reads them when it adds a book (lib/fileIdentity) */
export type Identity = { title: string; author: string }

export type DuplicateGroup = {
  title: string
  /** the author the identification found, when it did; empty otherwise */
  author: string
  /** how the copies were found to be one book: by their file names, or by the title and author inside the files */
  by: 'name' | 'content'
  /** the book's main file: its EPUB, or with none, the best copy of the format there is */
  keep: DeviceFile
  /** the best copy of each other format: filed under the author's versions folder */
  versions: DeviceFile[]
  /** more copies of a format that is already there: for the user to approve deleting */
  surplus: DeviceFile[]
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** the name without its extension and without a download's \" (2)\" */
const stemOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).replace(/\s*\(\d+\)\s*$/, '').trim()
}

/** a path inside the books folder's versions folders belongs there on purpose */
export const isVersionPath = (path: string) => path.includes(`/${VERSIONS_DIR_NAME}/`)

/** The author's folder inside the books folder that a file is in, or undefined when it is somewhere else. */
export function authorDirOf(path: string): string | undefined {
  const marker = `/${LIBRARY_DIR_NAME}/`
  const at = path.indexOf(marker)
  if (at < 0) return undefined
  const parts = path.slice(at + marker.length).split('/')
  return parts.length > 1 && parts[0] !== VERSIONS_DIR_NAME ? parts[0] : undefined
}

const MIN_KEY = 4

/** Rank for choosing the copy of a format that stays: followed by the library, in the books folder, bigger, newer. */
function best(files: DeviceFile[], linked: Set<string>): DeviceFile {
  const rank = (f: DeviceFile) => [linked.has(f.path) ? 1 : 0, authorDirOf(f.path) ? 1 : 0, f.size, f.modified]
  return [...files].sort((a, b) => {
    const x = rank(a)
    const y = rank(b)
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!
    return a.path.localeCompare(b.path)
  })[0]!
}

/** an identity that says something about the book: a title that is not junk, long enough not to be everyone's */
const usable = (i: Identity | undefined): i is Identity => !!i && norm(i.title).length >= MIN_KEY && !isJunkTitle(i.title)

/**
 * The books that are on the phone more than once among `files`, with what stays, what is filed and what is surplus. Two files
 * are one book when their names say so (the same name, but for the extension and a download's " (2)"), or, with `identities`,
 * when the app would call them one book: the same title and author, compared exactly as when a book is added (lib/sameBook),
 * whatever the files are called. The more files the identities cover, the more is found; without them, only names count.
 */
export function findDuplicateGroups(files: DeviceFile[], linked: Set<string> = new Set(), identities: Map<string, Identity> = new Map()): DuplicateGroup[] {
  const cand = files.filter((f) => !isVersionPath(f.path))
  const parent = cand.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  const join = (a: number, b: number) => void (parent[root(a)] = root(b))

  const byName = new Map<string, number>()
  const byTitle = new Map<string, number[]>()
  cand.forEach((f, i) => {
    const key = norm(stemOf(f.name))
    if (key.length >= MIN_KEY) {
      const at = byName.get(key)
      if (at === undefined) byName.set(key, i)
      else join(i, at)
    }
    const id = identities.get(f.path)
    if (usable(id)) {
      const bucket = norm(splitBookName(id.title).title)
      byTitle.set(bucket, [...(byTitle.get(bucket) ?? []), i])
    }
  })
  for (const bucket of byTitle.values())
    for (let a = 0; a < bucket.length; a++)
      for (let b = a + 1; b < bucket.length; b++)
        if (sameBook(identities.get(cand[bucket[a]!]!.path)!, identities.get(cand[bucket[b]!]!.path)!)) join(bucket[a]!, bucket[b]!)

  const groups = new Map<number, DeviceFile[]>()
  cand.forEach((f, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), f]))

  const out: DuplicateGroup[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const byExt = new Map<string, DeviceFile[]>()
    for (const f of group) byExt.set(extOf(f.name), [...(byExt.get(extOf(f.name)) ?? []), f])
    const kept = new Map([...byExt].map(([ext, list]) => [ext, best(list, linked)] as const))
    const mainExt = kept.has('epub') ? 'epub' : [...kept.keys()].sort()[0]!
    const keep = kept.get(mainExt)!
    const versions = [...kept].filter(([ext]) => ext !== mainExt).map(([, f]) => f)
    const surplus = group.filter((f) => f !== keep && !versions.includes(f))
    const named = new Set(group.map((f) => norm(stemOf(f.name))))
    const by = named.size > 1 ? 'content' : 'name'
    const id = identities.get(keep.path)
    out.push({ title: by === 'content' && usable(id) ? id.title : stemOf(keep.name), author: by === 'content' && usable(id) ? id.author : '', by, keep, versions, surplus })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}
