import { t } from '../i18n'
import { validRating, validTime, type Annotation, type BookRecord, type Progress } from './db'
import type { Stats } from './stats'
import type { Settings } from './settings'
import type { CardState, VocabWord } from './flashcards'
import { isCustomFont, type CustomFont } from './customFont'
import { cleanRanges } from './readCover'
import type { PaceData } from './pace'

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
  /** everything but the Google Books key, which stays on the device */
  settings?: Omit<Settings, 'googleBooksKey'>
  /** reading-speed stats per book id */
  stats?: Record<string, Stats>
  /** active reading seconds per day ('YYYY-MM-DD'), for reading goals */
  readingLog?: Record<string, number>
  /** active reading seconds per hour ('YYYY-MM-DDTHH'), for the time-of-day heatmap */
  readingHours?: Record<string, number>
  /** the learned reading pace and its monthly history (lib/pace) */
  readingPace?: PaceData
  /** words looked up in the dictionary, and how well each flashcard is known */
  vocab?: VocabWord[]
  cardStates?: Record<string, CardState>
  /** the font the user uploaded, as stored on the device (a data: URL) */
  customFont?: CustomFont
  /** folders the user created, including empty ones */
  folders?: string[]
}

export const CORRUPT = t('backup.corrupt')

/** read stretches that aren't well-formed are dropped (the position itself is kept) */
function cleanProgress(raw: Record<string, unknown>): Manifest['progress'] {
  const out: Record<string, Progress> = {}
  for (const [id, p] of Object.entries(raw)) {
    if (!isObj(p)) continue
    const { read, ...rest } = p as unknown as Progress
    const ranges = read === undefined ? undefined : cleanRanges(read)
    out[id] = { ...rest, ...(ranges && { read: ranges }) }
  }
  return out
}

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
      rating: validRating(b.rating) ? b.rating : undefined,
      finishedAt: validTime(b.finishedAt) ? b.finishedAt : undefined,
      // anything but a boolean is checked again on first open
      scripted: typeof b.scripted === 'boolean' ? b.scripted : undefined,
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
    progress: isObj(raw.progress) ? cleanProgress(raw.progress) : undefined,
    settings: isObj(raw.settings) ? (raw.settings as unknown as Settings) : undefined,
    stats: isObj(raw.stats) ? (raw.stats as Manifest['stats']) : undefined,
    readingLog: isObj(raw.readingLog) ? (raw.readingLog as Manifest['readingLog']) : undefined,
    readingHours: isObj(raw.readingHours) ? (raw.readingHours as Manifest['readingHours']) : undefined,
    readingPace: isObj(raw.readingPace) ? (raw.readingPace as unknown as PaceData) : undefined,
    vocab: Array.isArray(raw.vocab) ? (raw.vocab as VocabWord[]) : undefined,
    cardStates: isObj(raw.cardStates) ? (raw.cardStates as Manifest['cardStates']) : undefined,
    customFont: isCustomFont(raw.customFont) ? raw.customFont : undefined,
    folders: Array.isArray(raw.folders) ? raw.folders.filter((f): f is string => typeof f === 'string' && f.trim() !== '') : undefined,
  }
}
