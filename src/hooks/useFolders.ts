import { useEffect, useMemo, useRef, useState } from 'react'
import { addFolderName, removeFolderName, renameFolder, setFolder, type BookMeta } from '../lib/db'
import { autoSyncPhoneNames } from '../lib/phoneFiles'
import { folderKey, folderToStore, groupFolders, sortFolders, type Folder, type FolderSort } from '../lib/folders'
import type { Confirm } from './useConfirm'
import { localeTag, t } from '../i18n'

export type FolderDialogState = { rename?: string; name: string; author?: boolean }

type Deps = {
  books: BookMeta[]
  /** the books that pass the current search, filter and sort */
  shown: BookMeta[]
  createdNames: string[]
  searching: boolean
  refresh: () => Promise<void>
  showToast: (msg: string) => void
  exitSelect: () => void
  deleteBooks: (list: BookMeta[]) => Promise<void>
  confirm: Confirm
  sort: FolderSort
  /** folders above the single books (true) or below them */
  foldersFirst: boolean
}

const FOLDER_KEY = 'reader:folder'

/** the folder the library opens in next time it is shown (from the end of a book: "more by this author") */
export const openFolderNext = (key: string) => sessionStorage.setItem(FOLDER_KEY, key)

/** folder grouping, the folder being viewed, and moving books between folders */
export function useFolders({ books, shown, createdNames, searching, refresh, showToast, exitSelect, deleteBooks, confirm, sort, foldersFirst }: Deps) {
  // the folder being viewed (its key; '' = books without an author) and the books being moved
  // kept for the session: opening a book unmounts the library, and back from the book returns to this folder
  const [openFolder, setOpenFolderState] = useState<string | undefined>(() => sessionStorage.getItem(FOLDER_KEY) ?? undefined)
  const show = (key: string | undefined) => {
    if (key === undefined) sessionStorage.removeItem(FOLDER_KEY)
    else sessionStorage.setItem(FOLDER_KEY, key)
    setOpenFolderState(key)
  }
  // the folders left by following a link between a shared folder and its authors, so back returns to each in turn
  const trail = useRef<string[]>([])
  const setOpenFolder = (key: string | undefined) => {
    trail.current = []
    show(key)
  }
  const followFolder = (key: string) => {
    if (openFolder !== undefined) trail.current.push(openFolder)
    show(key)
  }
  /** one step back: the folder a link was followed from, else the folder list */
  const folderBack = () => show(trail.current.pop())
  const [moving, setMoving] = useState<BookMeta[]>()
  const [newFolder, setNewFolder] = useState('')
  // creating a folder, or renaming the one being viewed (name typed so far; `author`: its books take the new name as author)
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>()

  // created folders with no books at all are listed too (a filter hiding a folder's books doesn't make it empty)
  const allFolders = useMemo(() => {
    const full = groupFolders(books)
    const keys = new Set(full.map((f) => f.key))
    const empty: Folder[] = createdNames
      .map((name) => ({ key: folderKey({ author: name }), name, books: [] }))
      .filter((f) => f.key && !keys.has(f.key))
    return [...full, ...empty].sort((a, b) => (!a.key ? 1 : !b.key ? -1 : a.name.localeCompare(b.name, localeTag())))
  }, [books, createdNames])
  // an author with one book is shown as that book; a folder the user made or filled stays a folder
  const loose = useMemo(() => {
    const made = new Set(createdNames.map((name) => folderKey({ author: name })))
    return new Set(allFolders.filter((f) => f.books.length === 1 && f.books[0]!.folder === undefined && !made.has(f.key)).map((f) => f.key))
  }, [allFolders, createdNames])
  // the folder list follows the sort picker and the folders-above/below choice
  const folders = useMemo(() => {
    const withBooks = new Map(groupFolders(shown).map((f) => [f.key, f]))
    const visible = allFolders.flatMap((f) => (f.books.length ? (withBooks.get(f.key) ?? []) : f))
    return sortFolders(visible, loose, sort, foldersFirst)
  }, [allFolders, shown, loose, sort, foldersFirst])
  // with a single folder there is nothing to choose: show its books straight away
  const current =
    openFolder === undefined
      ? folders.length === 1
        ? folders[0]
        : undefined
      : folders.find((f) => f.key === openFolder)
  // a folder that emptied out (or is filtered away) falls back to the folder list
  useEffect(() => {
    // (not before the books have loaded: the folder remembered across opening a book must survive the first render)
    // oxlint-disable-next-line react/set-state-in-effect -- leaves a folder that no longer exists
    if (openFolder !== undefined && !current && !searching && books.length > 0) setOpenFolder(undefined)
  }, [openFolder, current, searching, books.length])

  /** `setAuthor`: the moved books also take the folder's name as their author */
  const moveTo = async (list: BookMeta[], name: string | undefined, created = false, setAuthor = false) => {
    setMoving(undefined)
    setNewFolder('')
    // books whose author already names the target folder go back to "filed by author" rather than storing a copy
    const plain = list.filter((b) => name === undefined || folderToStore(b, name) === undefined)
    const explicit = list.filter((b) => !plain.includes(b))
    if (plain.length) await setFolder(plain.map((b) => b.id), undefined)
    if (explicit.length && name !== undefined) await setFolder(explicit.map((b) => b.id), name, setAuthor)
    if (created && name) await addFolderName(name)
    void autoSyncPhoneNames(list.map((b) => b.id)).catch(() => {})
    exitSelect()
    await refresh()
    showToast(
      name === undefined ? t('folder.returned') : t('folder.movedTo', { name: name || t('folder.noAuthor') }),
    )
  }

  const saveFolderDialog = async () => {
    const d = folderDialog
    const name = d?.name.replace(/\s+/g, ' ').trim()
    if (!d || !name) return
    if (d.rename !== undefined) {
      const inside = books.filter((b) => folderKey(b) === folderKey({ author: d.rename! })).map((b) => b.id)
      await renameFolder(d.rename, name, !!d.author)
      void autoSyncPhoneNames(inside).catch(() => {})
      setOpenFolder(folderKey({ author: name }))
    } else await addFolderName(name)
    setFolderDialog(undefined)
    await refresh()
  }

  /** deletes the folders and every book in them (the books can be undone from the toast) */
  const deleteFolders = async (list: Folder[]) => {
    // the visible folder may hold only the books that pass the filter, so count the real ones
    const keys = new Set(list.map((f) => f.key))
    const all = allFolders.filter((f) => keys.has(f.key))
    const doomed = all.flatMap((f) => f.books)
    const title = t('folder.deleteTitle', { n: all.length, name: all[0]?.name || t('folder.noAuthor') })
    const text = doomed.length ? t('folder.deleteBooks', { n: doomed.length }) : t('folder.deleteEmpty', { n: all.length })
    if (!(await confirm({ title, text, ok: t('common.delete'), danger: true }))) return
    for (const f of all) if (f.key) await removeFolderName(f.name)
    setOpenFolder(undefined)
    exitSelect()
    if (doomed.length) await deleteBooks(doomed)
    else await refresh()
  }

  return {
    allFolders, folders, loose, current, openFolder, setOpenFolder, followFolder, folderBack,
    moving, setMoving, newFolder, setNewFolder,
    folderDialog, setFolderDialog, moveTo, saveFolderDialog, deleteFolders,
  }
}
