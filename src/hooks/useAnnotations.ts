import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import { compare as cfiCompare } from 'foliate-js/epubcfi.js'
import type { FoliateView } from 'foliate-js/view.js'
import { HIGHLIGHT_COLORS } from '../components/reader/colors'
import { getNotes, newId, saveNotes, type Annotation } from '../lib/db'
import { download } from '../lib/download'

/**
 * Highlights, notes and bookmarks of one book, kept in step with the highlights drawn in the view.
 * `notesRef` is the source of truth between renders: several edits can follow one another in one handler.
 */
export function useAnnotations(id: string, viewRef: MutableRefObject<FoliateView | null>, flash: (msg: string) => void) {
  const [notes, setNotes] = useState<Annotation[]>([])
  const notesRef = useRef<Annotation[]>([])

  const commit = useCallback(
    (next: Annotation[]) => {
      notesRef.current = next
      setNotes(next)
      saveNotes(id, next).catch((e) => {
        console.error(e)
        flash(e instanceof Error && e.name === 'QuotaExceededError' ? 'אין מקום באחסון — ההערה לא נשמרה' : 'שמירת ההערה נכשלה')
      })
    },
    [id, flash],
  )

  /** read the saved notes; awaited before the book is shown so its highlights can be drawn */
  const load = useCallback(async () => {
    const saved = await getNotes(id)
    notesRef.current = saved
    setNotes(saved)
  }, [id])

  /** draw every highlight on a freshly created overlay */
  const drawAll = useCallback((view: FoliateView) => {
    for (const n of notesRef.current) {
      if (n.kind === 'highlight') view.addAnnotation({ value: n.cfi, color: n.color }).catch(console.error)
    }
  }, [])

  const findByCfi = useCallback((cfi: string) => notesRef.current.find((x) => x.cfi === cfi), [])

  /** returns the new highlight's id */
  const addHighlight = (cfi: string, text: string, color: string) => {
    const note: Annotation = { id: newId(), kind: 'highlight', cfi, text, color, createdAt: Date.now() }
    commit([...notesRef.current, note])
    viewRef.current?.addAnnotation({ value: cfi, color }).catch(console.error)
    return note.id
  }

  const update = (noteId: string, patch: Partial<Annotation>) => {
    const next = notesRef.current.map((n) => (n.id === noteId ? { ...n, ...patch } : n))
    commit(next)
    const n = next.find((x) => x.id === noteId)
    if (n && patch.color && n.kind === 'highlight') {
      viewRef.current?.addAnnotation({ value: n.cfi, color: n.color }).catch(console.error)
    }
  }

  const remove = (noteId: string) => {
    const n = notesRef.current.find((x) => x.id === noteId)
    if (!n) return
    commit(notesRef.current.filter((x) => x.id !== noteId))
    if (n.kind === 'highlight') viewRef.current?.deleteAnnotation({ value: n.cfi }).catch(console.error)
  }

  /** add a bookmark at `cfi`, or remove the one already there */
  const toggleBookmark = (cfi: string, label: string) => {
    const existing = notesRef.current.find((n) => n.kind === 'bookmark' && n.cfi === cfi)
    if (existing) {
      remove(existing.id)
      flash('הסימנייה הוסרה')
      return
    }
    commit([
      ...notesRef.current,
      { id: newId(), kind: 'bookmark', cfi, text: label, color: HIGHLIGHT_COLORS[0] ?? '', createdAt: Date.now() },
    ])
    flash('נוספה סימנייה')
  }

  /** the next (dir 1) or previous (dir -1) bookmark after `here`, in reading order; flashes why when there is none */
  const bookmarkFrom = (here: string | undefined, dir: 1 | -1) => {
    const marks = notesRef.current.filter((n) => n.kind === 'bookmark').sort((a, b) => cfiCompare(a.cfi, b.cfi))
    if (!marks.length) {
      flash('אין סימניות בספר')
      return undefined
    }
    const target = here
      ? dir === 1
        ? marks.find((n) => cfiCompare(n.cfi, here) > 0)
        : [...marks].reverse().find((n) => cfiCompare(n.cfi, here) < 0)
      : marks[0]
    if (!target) flash(dir === 1 ? 'אין סימנייה נוספת קדימה' : 'אין סימנייה קודמת')
    return target
  }

  const exportMarkdown = (title: string) => {
    const list = [...notesRef.current].sort((a, b) => a.createdAt - b.createdAt)
    if (!list.length) return flash('אין מה לייצא')
    const quote = (s: string) => s.replace(/\s*\n\s*/g, ' ')
    const lines = [`# ${title}`, '']
    const marks = list.filter((n) => n.kind === 'bookmark')
    const hls = list.filter((n) => n.kind === 'highlight')
    if (hls.length) {
      lines.push('## הדגשות', '')
      for (const n of hls) {
        lines.push(`> ${quote(n.text)}`)
        if (n.note) lines.push('', n.note)
        lines.push('')
      }
    }
    if (marks.length) lines.push('## סימניות', '', ...marks.map((n) => `- ${n.text}`), '')
    download(
      new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }),
      `${title.replace(/[\\/:*?"<>|]/g, '_') || 'הערות'}.md`,
    )
  }

  return { notes, load, drawAll, findByCfi, addHighlight, update, remove, toggleBookmark, bookmarkFrom, exportMarkdown }
}
