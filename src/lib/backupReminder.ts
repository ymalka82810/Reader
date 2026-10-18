import { getFile, listBooks } from './db'
import { loadSettings, type BackupRemind } from './settings'

const BACKUP_KEY = 'reader:lastBackup'
const SINCE_KEY = 'reader:backupSince'
const DAY_MS = 24 * 3600 * 1000
const REMIND_AFTER_MS: Record<Exclude<BackupRemind, 'off'>, number> = { default: 14 * DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS }
const URGENT_REMIND_AFTER_MS = 3 * DAY_MS

export function markBackedUp() {
  try {
    localStorage.setItem(BACKUP_KEY, String(Date.now()))
  } catch {
    /* localStorage unavailable or full: the setting just won't persist */
  }
}

/** true when the library has gone longer than the chosen interval (two weeks by default) without a backup, counted from first use if never
 *  backed up; storage the browser may clear shortens it to three days, and the choice "never" silences it */
export function backupDue(urgent = false): boolean {
  const choice = loadSettings().backupRemind
  if (choice === 'off') return false
  const limit = urgent ? Math.min(URGENT_REMIND_AFTER_MS, REMIND_AFTER_MS[choice]) : REMIND_AFTER_MS[choice]
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
