import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import { compare as cfiCompare } from 'foliate-js/epubcfi.js'
import type { FoliateView } from 'foliate-js/view.js'
import { COLOR_NAMES, HIGHLIGHT_COLORS } from '../components/reader/colors'
import { getNotes, newId, saveNotes, type Annotation } from '../lib/db'
import { download } from '../lib/download'
import { buildMarkdown, buildObsidian, buildPrintHtml, printHtml, safeFileName, type ExportFormat, type ExportNote } from '../lib/notesExport'
import { t } from '../i18n'

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
        flash(e instanceof Error && e.name === 'QuotaExceededError' ? t('notes.quota') : t('notes.saveFailed'))
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
      flash(t('notes.bookmarkRemoved'))
      return
    }
    commit([
      ...notesRef.current,
      { id: newId(), kind: 'bookmark', cfi, text: label, color: HIGHLIGHT_COLORS[0] ?? '', createdAt: Date.now() },
    ])
    flash(t('notes.bookmarkAdded'))
  }

  /** the next (dir 1) or previous (dir -1) bookmark after `here`, in reading order; flashes why when there is none */
  const bookmarkFrom = (here: string | undefined, dir: 1 | -1) => {
    const marks = notesRef.current.filter((n) => n.kind === 'bookmark').sort((a, b) => cfiCompare(a.cfi, b.cfi))
    if (!marks.length) {
      flash(t('notes.noBookmarks'))
      return undefined
    }
    const target = here
      ? dir === 1
        ? marks.find((n) => cfiCompare(n.cfi, here) > 0)
        : [...marks].reverse().find((n) => cfiCompare(n.cfi, here) < 0)
      : marks[0]
    if (!target) flash(dir === 1 ? t('notes.noNextBookmark') : t('notes.noPrevBookmark'))
    return target
  }

  /** where a note sits: its chapter and the reading progress at the start of its section */
  const locate = async (view: FoliateView | null, cfi: string) => {
    if (!view) return { chapter: '', percent: 0 }
    try {
      const { index } = await view.resolveNavigation(cfi)
      const percent = Math.round((view.getSectionFractions()[index] ?? 0) * 100)
      const chapter = (await view.getTOCItemOf(cfi))?.label ?? ''
      return { chapter: chapter.trim(), percent }
    } catch (e) {
      console.error(e)
      return { chapter: '', percent: 0 }
    }
  }

  const exportNotes = async (title: string, format: ExportFormat) => {
    const list = [...notesRef.current].sort((a, b) => a.createdAt - b.createdAt)
    if (!list.length) return flash(t('notes.nothingToExport'))
    const view = viewRef.current
    const items: ExportNote[] = []
    for (const n of list) {
      items.push({
        kind: n.kind,
        text: n.text,
        note: n.note,
        color: n.color,
        createdAt: n.createdAt,
        colorName: n.kind === 'highlight' ? (COLOR_NAMES[HIGHLIGHT_COLORS.indexOf(n.color)] ?? '') : '',
        ...(n.kind === 'highlight' ? await locate(view, n.cfi) : { chapter: '', percent: 0 }),
      })
    }
    const labels = { highlights: t('notes.exportHighlights'), bookmarks: t('notes.exportBookmarks'), exportedOn: t('notes.exportedOn') }
    if (format === 'pdf') return printHtml(buildPrintHtml(title, items, labels, view?.book.dir === 'rtl' ? 'rtl' : 'ltr'))
    const text = format === 'obsidian' ? buildObsidian(title, items, labels) : buildMarkdown(title, items, labels)
    download(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(title, t('notes.fileName'))}.md`)
  }

  return { notes, load, drawAll, findByCfi, addHighlight, update, remove, toggleBookmark, bookmarkFrom, exportNotes }
}
