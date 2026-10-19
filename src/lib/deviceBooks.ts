// The books already on the phone (Android app only), picked up by the library by itself.
// Talks to the native DeviceBooks plugin (resources/android-device-books/DeviceBooksPlugin.java)
// through the injected Capacitor bridge, so @capacitor/core isn't bundled.

import { createStore, entries, setMany } from 'idb-keyval'
import { t } from '../i18n'
import { loadSettings, type Settings } from './settings'

interface CapacitorBridge {
  isNativePlatform?: () => boolean
  isPluginAvailable?: (name: string) => boolean
  nativePromise: <T>(plugin: string, method: string, options?: object) => Promise<T>
  convertFileSrc?: (path: string) => string
}

const cap = () => (globalThis as unknown as { Capacitor?: CapacitorBridge }).Capacitor
const call = <T>(method: string, options?: object) => cap()!.nativePromise<T>('DeviceBooks', method, options)

/** a book file found on the phone */
export type DeviceFile = { path: string; name: string; size: number; modified: number }

/** book formats only: Word and text files in Download are rarely books, and audio has its own apps */
const BOOK_EXTENSIONS = ['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'cbz']

export const deviceBooksSupported = () => {
  const c = cap()
  return !!c?.isNativePlatform?.() && (c.isPluginAvailable?.('DeviceBooks') ?? true)
}

export async function hasDeviceAccess(): Promise<boolean> {
  if (!deviceBooksSupported()) return false
  try {
    return (await call<{ granted: boolean }>('status')).granted
  } catch {
    return false
  }
}

/** opens the system screen ("All files access") or permission dialog; resolves once the user is back */
export async function requestDeviceAccess(): Promise<boolean> {
  return (await call<{ granted: boolean }>('requestAccess')).granted
}

/** the folder the user picked, relative to the storage root ('' is the whole storage); undefined when cancelled.
 *  Rejects with Error("not local") for a folder outside the phone's own storage. */
export async function pickDeviceFolder(): Promise<string | undefined> {
  return (await call<{ folder?: string }>('pickFolder')).folder
}

export async function scanDevice(folders: string[]): Promise<DeviceFile[]> {
  return (await call<{ files: DeviceFile[] }>('scan', { folders, extensions: BOOK_EXTENSIONS })).files
}

/** "Books/Hebrew/" and "/Books/Hebrew" are the same folder as "Books/Hebrew" */
export const normalizeFolder = (f: string) => f.trim().replace(/^\/+|\/+$/g, '')

// Every file the library has already dealt with (added, skipped as a duplicate, or failed), by path, with the size
// and time it had then. A book the user later deletes from the library therefore doesn't come back on the next scan,
// while a file that was replaced on the phone (new size or time) is looked at again.
const seenStore = createStore('reader-device-db', 'seen')
const stamp = (f: DeviceFile) => `${f.size}|${f.modified}`

/** the files not dealt with before, in a stable order (by folder, then name) */
export function pickNew(files: DeviceFile[], seen: Map<string, string>): DeviceFile[] {
  return files.filter((f) => seen.get(f.path) !== stamp(f)).sort((a, b) => a.path.localeCompare(b.path))
}

export async function newDeviceFiles(files: DeviceFile[]): Promise<DeviceFile[]> {
  const seen = new Map((await entries<string, string>(seenStore)).map(([k, v]) => [String(k), v]))
  return pickNew(files, seen)
}

export const markSeen = (files: DeviceFile[]) => setMany(files.map((f) => [f.path, stamp(f)]), seenStore)

const TYPES: Record<string, string> = { epub: 'application/epub+zip', pdf: 'application/pdf' }

/** the file's content, read through Capacitor's local server instead of the bridge */
export async function readDeviceFile(f: DeviceFile): Promise<File> {
  // encoded per segment, so a '#', '?' or '%' in a file name stays part of the path
  const src = cap()?.convertFileSrc?.(f.path.split('/').map(encodeURIComponent).join('/'))
  if (!src) throw new Error('no file access')
  const res = await fetch(src)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  return new File([await res.blob()], f.name, { type: TYPES[ext] ?? '', lastModified: f.modified })
}

/** asks for the notification permission (Android 13+ shows a dialog); resolves with the answer */
export async function requestNotificationAccess(): Promise<boolean> {
  if (!deviceBooksSupported()) return false
  try {
    return (await call<{ granted: boolean }>('requestNotifications')).granted
  } catch {
    return false
  }
}

/** true once after the app was opened from the \"new books found\" notification, so the library offers them at once */
export async function consumeScanNotificationTap(): Promise<boolean> {
  if (!deviceBooksSupported()) return false
  try {
    return (await call<{ tapped: boolean }>('consumeNotificationTap')).tapped
  } catch {
    return false
  }
}

/** every file the library has dealt with, as {path: \"size|modified\"} */
async function seenFiles(): Promise<Record<string, string>> {
  return Object.fromEntries((await entries<string, string>(seenStore)).map(([k, v]) => [String(k), v]))
}

/**
 * Tells the native side whether to keep scanning while the app is closed or not on the screen (it checks every
 * ~15 minutes and posts one notification about new books; it never adds any), with the folders, the books the
 * library already knows and the notification's texts. Called when the app comes forward or goes away and when
 * the setting changes, so the native side always has the latest.
 */
export async function syncBackgroundScan(s: Pick<Settings, 'deviceBackgroundScan' | 'deviceFolders'> = loadSettings()): Promise<void> {
  if (!deviceBooksSupported()) return
  try {
    if (!s.deviceBackgroundScan || !(await hasDeviceAccess())) {
      await call('setBackground', { enabled: false })
      return
    }
    await call('setBackground', {
      enabled: true,
      folders: s.deviceFolders,
      extensions: BOOK_EXTENSIONS,
      known: await seenFiles(),
      title: t('device.bgTitle'),
      textOne: t('device.bgOne'),
      textMany: t('device.bgMany'),
      channel: t('device.bgChannel'),
    })
  } catch (e) {
    console.warn('device scan: background scan not updated', e)
  }
}
