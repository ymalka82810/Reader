import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteBook, listBooks, listFolderNames, type BookMeta } from '../lib/db'
import { t } from '../i18n'

/** how long a deleted book can still be restored with "Undo" */
const UNDO_MS = 7000

type Toasts = {
  showToast: (msg: string, undo?: () => void, ms?: number) => void
  clearToast: () => void
}

/** the book list, plus deletion that stays undoable for a few seconds */
export function useLibrary(setError: (msg: string | undefined) => void, { showToast, clearToast }: Toasts) {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [createdNames, setCreatedNames] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false) // false until the first read of the library is done: an empty list then means "still loading"
  // books removed from view that can still be restored; they are deleted for real once `timer` fires
  const pendingDel = useRef<{ ids: string[]; timer: number }>(undefined)

  const refresh = useCallback(async () => {
    try {
      const hidden = new Set(pendingDel.current?.ids)
      setBooks((await listBooks()).filter((b) => !hidden.has(b.id)))
      setCreatedNames(await listFolderNames())
    } catch (e) {
      console.error(e)
      setError(t('lib.storageBlocked'))
    } finally {
      setLoaded(true)
    }
  }, [setError])
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads the library from IndexedDB
    refresh()
  }, [refresh])

  const commitDelete = async () => {
    const p = pendingDel.current
    if (!p) return
    window.clearTimeout(p.timer)
    pendingDel.current = undefined
    try {
      for (const id of p.ids) await deleteBook(id)
    } catch (e) {
      setError(t('lib.deleteFailed', { msg: e instanceof Error ? e.message : String(e) }))
    }
    await refresh()
  }
  // leaving the library (or closing the page) finishes a deletion that is still waiting out its undo window
  useEffect(() => {
    window.addEventListener('pagehide', commitDelete)
    return () => {
      window.removeEventListener('pagehide', commitDelete)
      commitDelete()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- commitDelete only reads refs and stable setters
  }, [])

  const undoDelete = () => {
    const p = pendingDel.current
    if (!p) return
    window.clearTimeout(p.timer)
    pendingDel.current = undefined
    clearToast()
    refresh()
  }

  const deleteBooks = async (list: BookMeta[]) => {
    await commitDelete() // an earlier deletion still waiting becomes final
    const ids = list.map((b) => b.id)
    pendingDel.current = { ids, timer: window.setTimeout(commitDelete, UNDO_MS) }
    setBooks((prev) => prev.filter((b) => !ids.includes(b.id)))
    showToast(t('lib.deleted', { n: list.length, title: list[0]?.title ?? '' }), undoDelete, UNDO_MS)
  }

  return { books, createdNames, loaded, refresh, deleteBooks }
}
