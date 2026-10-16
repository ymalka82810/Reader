import { getFile, listBooks } from './db'

const BACKUP_KEY = 'reader:lastBackup'
const SINCE_KEY = 'reader:backupSince'
const REMIND_AFTER_MS = 14 * 24 * 3600 * 1000
const URGENT_REMIND_AFTER_MS = 3 * 24 * 3600 * 1000

export function markBackedUp() {
  try {
    localStorage.setItem(BACKUP_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** true when the library has gone more than two weeks without a backup (counted from first use if never backed up) */
export function backupDue(urgent = false): boolean {
  const limit = urgent ? URGENT_REMIND_AFTER_MS : REMIND_AFTER_MS
  try {
    const last = Number(localStorage.getItem(BACKUP_KEY)) || 0
    if (last) return Date.now() - last > limit
    let since = Number(localStorage.getItem(SINCE_KEY)) || 0
    if (!since) {
      since = Date.now()
      localStorage.setItem(SINCE_KEY, String(since))
    }
    return Date.now() - since > limit
  } catch {
    return false
  }
}

/** total bytes of book files and covers, to warn before building a backup too big for memory */
export async function librarySize(): Promise<number> {
  let sum = 0
  for (const b of await listBooks()) sum += ((await getFile(b.id))?.size ?? 0) + (b.cover?.size ?? 0)
  return sum
}
