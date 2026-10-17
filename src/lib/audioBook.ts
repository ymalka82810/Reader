/** Audiobooks (m4b / mp3 / m4a …): file detection, tags + chapters, and the time-based "location" they use
 *  in place of an EPUB CFI (reading position and bookmarks share the book's regular stores). */

import { t } from '../i18n'

export interface AudioChapter {
  title: string
  /** seconds from the start */
  start: number
}

export interface AudioInfo {
  /** seconds; 0 when the file does not say */
  duration: number
  chapters: AudioChapter[]
}

const AUDIO_EXT = /\.(m4b|mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i
export const isAudio = (f: Pick<File, 'name' | 'type'>) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/')

const PREFIX = 't:'
/** the stored "location" of a moment in an audiobook */
export const timeLoc = (secs: number) => PREFIX + Math.max(0, Math.round(secs * 10) / 10)
/** seconds for a location made by timeLoc; undefined for anything else (e.g. an EPUB CFI) */
export function locTime(loc: string | undefined): number | undefined {
  if (!loc?.startsWith(PREFIX)) return undefined
  const n = Number(loc.slice(PREFIX.length))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** 75 → "1:15", 3725 → "1:02:05" */
export function formatTime(secs: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(secs) ? secs : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** index of the chapter playing at `t` (-1 before the first one or when there are none) */
export function chapterAt(chapters: AudioChapter[], t: number): number {
  let lo = 0
  let hi = chapters.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (chapters[mid]!.start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const MIN_SPEED = 0.5
export const MAX_SPEED = 3
export const clampSpeed = (v: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(v * 20) / 20))

export interface AudioMeta {
  title: string
  author: string
  cover?: Blob
  info: AudioInfo
}

/** reads tags, cover art and chapters; the tag parser is loaded only when an audio file is imported */
export async function readAudioMeta(file: File): Promise<AudioMeta> {
  const { parseBlob, selectCover } = await import('music-metadata')
  const m = await parseBlob(file, { includeChapters: true })
  const pic = selectCover(m.common.picture)
  const duration = m.format.duration ?? 0
  const chapters = (m.format.chapters ?? [])
    .map((c, i) => ({ title: c.title?.trim() || t('audio.chapterN', { n: i + 1 }), start: Math.max(0, c.start / (c.timeScale ?? 1000)) }))
    .filter((c) => Number.isFinite(c.start) && (!duration || c.start < duration))
    .sort((a, b) => a.start - b.start)
  return {
    title: m.common.album?.trim() || m.common.title?.trim() || '',
    author: m.common.artist?.trim() || m.common.albumartist?.trim() || '',
    cover: pic ? new Blob([pic.data as BlobPart], { type: pic.format }) : undefined,
    info: { duration, chapters },
  }
}
