import { t } from '../i18n'
import type { Annotation, BookRecord, Progress } from './db'
import type { Stats } from './stats'
import type { Settings } from './settings'
import type { CardState, VocabWord } from './flashcards'

/** Container format: [4-byte LE header length][JSON header][concatenated blob bytes].
 *  Keeps the whole library (files, covers, metadata, reading progress) in one file,
 *  with no dependency on a zip library. */

export interface ManifestBook extends Omit<BookRecord, 'file' | 'cover'> {
  fileType: string
  fileRange: [number, number]
  coverType?: string
  coverRange?: [number, number]
}

export interface Manifest {
  version: 1
  books: ManifestBook[]
  /** highlights/bookmarks per book id (absent in backups made before annotations existed) */
  notes?: Record<string, Annotation[]>
  /** reading positions per book id (older backups carry them inside each book instead) */
  progress?: Record<string, Progress>
  /** display settings of the device that made the backup */
  settings?: Settings
  /** reading-speed stats per book id */
  stats?: Record<string, Stats>
  /** active reading seconds per day ('YYYY-MM-DD'), for reading goals */
  readingLog?: Record<string, number>
  /** words looked up in the dictionary, and how well each flashcard is known */
  vocab?: VocabWord[]
  cardStates?: Record<string, CardState>
}

export const CORRUPT = t('backup.corrupt')

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function checkRange(v: unknown, bodySize: number): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(CORRUPT)
  const [a, b] = v as unknown[]
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error(CORRUPT)
  if ((a as number) < 0 || (a as number) > (b as number) || (b as number) > bodySize) throw new Error(CORRUPT)
  return [a as number, b as number]
}

/** parses and validates the manifest; `bodySize` is the number of bytes after the header, which every range must fit in */
export function parseManifest(text: string, bodySize: number): Manifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(CORRUPT)
  }
  if (!isObj(raw) || !Array.isArray(raw.books)) throw new Error(CORRUPT)
  if (raw.version !== 1) throw new Error(t('backup.unsupported'))
  const books = raw.books.map((b: unknown): ManifestBook => {
    if (!isObj(b) || typeof b.id !== 'string' || !b.id || typeof b.title !== 'string') throw new Error(CORRUPT)
    const fileRange = checkRange(b.fileRange, bodySize)
    const coverRange = b.coverRange === undefined ? undefined : checkRange(b.coverRange, bodySize)
    return {
      ...(b as unknown as ManifestBook),
      author: typeof b.author === 'string' ? b.author : '',
      fileName: typeof b.fileName === 'string' ? b.fileName : `${b.id}.epub`,
      addedAt: Number.isFinite(b.addedAt) ? (b.addedAt as number) : Date.now(),
      fileType: typeof b.fileType === 'string' ? b.fileType : '',
      coverType: typeof b.coverType === 'string' ? b.coverType : undefined,
      fileRange,
      coverRange,
    }
  })
  const notes: Record<string, Annotation[]> = {}
  if (isObj(raw.notes)) for (const [id, list] of Object.entries(raw.notes)) if (Array.isArray(list)) notes[id] = list
  return {
    version: 1,
    books,
    notes,
    progress: isObj(raw.progress) ? (raw.progress as Manifest['progress']) : undefined,
    settings: isObj(raw.settings) ? (raw.settings as unknown as Settings) : undefined,
    stats: isObj(raw.stats) ? (raw.stats as Manifest['stats']) : undefined,
    readingLog: isObj(raw.readingLog) ? (raw.readingLog as Manifest['readingLog']) : undefined,
    vocab: Array.isArray(raw.vocab) ? (raw.vocab as VocabWord[]) : undefined,
    cardStates: isObj(raw.cardStates) ? (raw.cardStates as Manifest['cardStates']) : undefined,
  }
}
