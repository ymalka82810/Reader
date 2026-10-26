// A count of what the phone's scanned folders hold, for the overview screen: how many book files, in which formats, how many
// are in the app's books folder and how many outside it, which the library follows, what is filed as a version, and what
// is there twice. Only counts what it is given; it touches no file.
import type { DeviceFile } from './deviceBooks'
import { authorDirOf, isVersionPath, type DuplicateGroup } from './phoneDuplicates'

export type PhoneOverview = {
  files: number
  bytes: number
  /** per format, the most files first */
  byFormat: { ext: string; count: number; bytes: number }[]
  /** files in an author's folder of the books folder */
  inBooksFolder: number
  /** files in a versions folder (other formats of a book, kept on purpose) */
  versions: number
  /** files elsewhere in the scanned folders */
  outside: number
  /** files the library follows (the book's file, or a version moved there) */
  tracked: number
  /** files the library does not know: neither followed nor a version */
  untracked: number
  /** paths the library follows that no scanned folder holds now (moved or deleted on the phone, or outside the folders) */
  missing: number
  duplicateGroups: number
  surplusFiles: number
  surplusBytes: number
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function summarizePhone(files: DeviceFile[], linked: Set<string>, groups: DuplicateGroup[]): PhoneOverview {
  const formats = new Map<string, { ext: string; count: number; bytes: number }>()
  const found = new Set<string>()
  const out: PhoneOverview = {
    files: files.length,
    bytes: 0,
    byFormat: [],
    inBooksFolder: 0,
    versions: 0,
    outside: 0,
    tracked: 0,
    untracked: 0,
    missing: 0,
    duplicateGroups: groups.length,
    surplusFiles: groups.reduce((n, g) => n + g.surplus.length, 0),
    surplusBytes: groups.reduce((n, g) => n + g.surplus.reduce((s, f) => s + f.size, 0), 0),
  }
  for (const f of files) {
    found.add(f.path)
    out.bytes += f.size
    const ext = extOf(f.name)
    const row = formats.get(ext) ?? { ext, count: 0, bytes: 0 }
    row.count++
    row.bytes += f.size
    formats.set(ext, row)
    if (isVersionPath(f.path)) out.versions++
    else if (authorDirOf(f.path)) out.inBooksFolder++
    else out.outside++
    if (linked.has(f.path)) out.tracked++
    else if (!isVersionPath(f.path)) out.untracked++
  }
  out.byFormat = [...formats.values()].sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
  out.missing = [...linked].filter((p) => !found.has(p)).length
  return out
}
