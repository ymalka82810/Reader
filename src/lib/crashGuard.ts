// A black box for the heavy, one-file-at-a-time work (adding a book, reading a phone file's title, identifying a book).
// Some files are too much for a phone (a huge comic, a broken PDF…): the WebView runs out of memory and the whole app
// closes, with no error to catch. Worse, the work is picked up again at the next start, from the same file, so the app
// would close again and again. So before a file is worked on, its key is written down, and wiped once it is done; a key
// still written down when the app starts again is the file that closed it. That file is set aside: the automatic work
// (the phone scan, the identification) skips it from then on, and the user is told its name once. Adding it by hand is
// still possible, and is guarded the same way.

const IN_FLIGHT_KEY = 'reader:inFlight'
const CRASHED_KEY = 'reader:crashedItems'
const NOTICE_KEY = 'reader:crashNotice'
/** the newest ones are kept; an old one that falls out is simply tried again */
const MAX_CRASHED = 500

export type Stage = 'import' | 'fileIdentity' | 'identify'
type Item = { name: string; stage: Stage; at: number }

/** the key of a file on the phone, of a file picked by hand, of a book in the library */
export const pathKey = (path: string) => `path:${path}`
export const fileKey = (name: string, size: number) => `file:${name}|${size}`
export const bookKey = (id: string) => `book:${id}`

function read<T>(key: string, empty: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : empty
  } catch {
    return empty
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // no storage: nothing is guarded, as before
  }
}

/** the work on `key` starts (written at once, so it survives the app closing in the middle of it) */
export function begin(key: string, name: string, stage: Stage) {
  const now = read<Record<string, Item>>(IN_FLIGHT_KEY, {})
  now[key] = { name, stage, at: Date.now() }
  write(IN_FLIGHT_KEY, now)
}

/** the work on `key` is over, however it ended (done, failed, cancelled) */
export function end(key: string) {
  const now = read<Record<string, Item>>(IN_FLIGHT_KEY, {})
  if (!(key in now)) return
  delete now[key]
  if (Object.keys(now).length) write(IN_FLIGHT_KEY, now)
  else {
    try {
      localStorage.removeItem(IN_FLIGHT_KEY)
    } catch {
      // nothing to do
    }
  }
}

/** runs `fn` with `key` written down meanwhile */
export async function guarded<T>(key: string, name: string, stage: Stage, fn: () => Promise<T>): Promise<T> {
  begin(key, name, stage)
  try {
    return await fn()
  } finally {
    end(key)
  }
}

/**
 * Called once when the app starts, before any work begins: whatever was still written down closed the app last time.
 * It is set aside, and its name kept for the notice. Resolves with how many were set aside.
 */
export function recoverCrash(): number {
  const left = read<Record<string, Item>>(IN_FLIGHT_KEY, {})
  const keys = Object.keys(left)
  if (!keys.length) return 0
  const crashed = read<Record<string, Item>>(CRASHED_KEY, {})
  for (const k of keys) crashed[k] = left[k]!
  const kept = Object.entries(crashed)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_CRASHED)
  write(CRASHED_KEY, Object.fromEntries(kept))
  write(NOTICE_KEY, keys.map((k) => left[k]!.name))
  try {
    localStorage.removeItem(IN_FLIGHT_KEY)
  } catch {
    // nothing to do
  }
  return keys.length
}

/** this file or book closed the app before: the automatic work leaves it alone */
export function crashedBefore(key: string): boolean {
  return key in read<Record<string, Item>>(CRASHED_KEY, {})
}

/** added by hand after all, and this time it went through: no longer set aside */
export function forgetCrashed(key: string) {
  const crashed = read<Record<string, Item>>(CRASHED_KEY, {})
  if (!(key in crashed)) return
  delete crashed[key]
  write(CRASHED_KEY, crashed)
}

/** the names of what closed the app last time, once (undefined when nothing did) */
export function takeCrashNotice(): string[] | undefined {
  const names = read<string[] | undefined>(NOTICE_KEY, undefined)
  if (!names?.length) return undefined
  try {
    localStorage.removeItem(NOTICE_KEY)
  } catch {
    // shown again next time
  }
  return names
}
