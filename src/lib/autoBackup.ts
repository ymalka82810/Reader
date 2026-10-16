import { createStore, get, set, del } from 'idb-keyval'
import { listBooks } from './db'
import { exportLibraryTo } from './backupExport'
import { markBackedUp } from './backupReminder'

/** Automatic backup into a folder the user picked (File System Access API, Chromium only).
 *  The folder handle lives in IndexedDB; the browser may ask to re-confirm access in a later session,
 *  which needs a click, so that case is surfaced as 'needs-permission' instead of failing silently. */
const store = createStore('reader-autobackup-db', 'handle')
const HANDLE_KEY = 'dir'
const LAST_KEY = 'reader:autoBackupLast'
const INTERVAL_MS = 24 * 3600 * 1000
/** one rolling file: a new backup replaces the previous one, so the folder never grows */
const FILE_NAME = 'גיבוי-אוטומטי.readerbackup'

export type AutoBackupState = 'unsupported' | 'off' | 'ready' | 'needs-permission'

type DirHandle = {
  name: string
  queryPermission(o: object): Promise<PermissionState>
  requestPermission(o: object): Promise<PermissionState>
  getFileHandle(name: string, o: object): Promise<{ createWritable(): Promise<any> }>
}

const MODE = { mode: 'readwrite' }

export const autoBackupSupported = () => typeof (window as any).showDirectoryPicker === 'function'

export function lastAutoBackup(): number {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0
  } catch {
    return 0
  }
}

export async function autoBackupState(): Promise<AutoBackupState> {
  if (!autoBackupSupported()) return 'unsupported'
  try {
    const dir = await get<DirHandle>(HANDLE_KEY, store)
    if (!dir) return 'off'
    return (await dir.queryPermission(MODE)) === 'granted' ? 'ready' : 'needs-permission'
  } catch (e) {
    console.warn('auto-backup state check failed', e)
    return 'off'
  }
}

/** asks the user for a folder; must be called straight from a click. Resolves false if they cancel. */
export async function chooseBackupFolder(): Promise<boolean> {
  try {
    const dir: DirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'reader-backup' })
    await set(HANDLE_KEY, dir, store)
    return true
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false
    throw e
  }
}

export const disableAutoBackup = () => del(HANDLE_KEY, store)

/** true when a day has passed since the last automatic backup */
export const autoBackupDue = () => Date.now() - lastAutoBackup() > INTERVAL_MS

/** Writes the backup into the chosen folder. With `interactive` (from a click) it may re-ask for access;
 *  otherwise it quietly does nothing when access has lapsed. Returns whether a backup was written. */
export async function runAutoBackup(interactive = false): Promise<boolean> {
  const dir = await get<DirHandle>(HANDLE_KEY, store)
  if (!dir) return false
  let perm = await dir.queryPermission(MODE)
  if (perm !== 'granted' && interactive) perm = await dir.requestPermission(MODE)
  if (perm !== 'granted') return false
  // never replace a good backup with an empty one
  if (!(await listBooks()).length) return false
  const sink = await (await dir.getFileHandle(FILE_NAME, { create: true })).createWritable()
  await exportLibraryTo(sink)
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()))
  } catch {
    /* the next launch will just back up again */
  }
  markBackedUp()
  return true
}
