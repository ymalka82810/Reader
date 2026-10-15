import { getAllProgress, getNotes, listBooks, mergeProgress, saveNotes, type Annotation, type Progress } from './db'

/** Small file (no book contents) for moving reading positions and notes between devices.
 *  Both devices must already hold the same books (e.g. restored from the same backup). */
interface SyncFile {
  kind: 'reader-sync'
  version: 1
  exportedAt: number
  books: Record<string, { title: string; progress?: Progress; notes?: Annotation[] }>
}

export async function exportSync(): Promise<Blob> {
  const progress = await getAllProgress()
  const books: SyncFile['books'] = {}
  for (const b of await listBooks()) {
    const notes = await getNotes(b.id)
    if (!progress[b.id] && !notes.length) continue
    books[b.id] = { title: b.title, progress: progress[b.id], notes: notes.length ? notes : undefined }
  }
  const data: SyncFile = { kind: 'reader-sync', version: 1, exportedAt: Date.now(), books }
  return new Blob([JSON.stringify(data)], { type: 'application/json' })
}

export async function importSync(file: File): Promise<{ moved: number; notes: number; skipped: number }> {
  const data = JSON.parse(await file.text()) as SyncFile
  if (data.kind !== 'reader-sync' || data.version !== 1) throw new Error('קובץ סנכרון לא תקין')
  const known = new Set((await listBooks()).map((b) => b.id))
  let moved = 0
  let notes = 0
  let skipped = 0
  for (const [id, entry] of Object.entries(data.books)) {
    if (!known.has(id)) {
      skipped++
      continue
    }
    if (entry.progress && (await mergeProgress(id, entry.progress))) moved++
    if (entry.notes?.length) {
      const byId = new Map((await getNotes(id)).map((n) => [n.id, n]))
      const before = byId.size
      for (const n of entry.notes) byId.set(n.id, n)
      notes += byId.size - before
      await saveNotes(id, [...byId.values()])
    }
  }
  return { moved, notes, skipped }
}
