import { useEffect, useRef } from 'react'
import {
  deviceBooksSupported,
  consumeScanNotificationTap,
  hasDeviceAccess,
  markSeen,
  newDeviceFiles,
  readDeviceFile,
  requestDeviceAccess,
  requestNotificationAccess,
  scanDevice,
  syncBackgroundScan,
  type DeviceFile,
} from '../lib/deviceBooks'
import { linkKnownBooks, phoneFilePaths, refreshPhoneFiles, refreshPhoneFilesOnce } from '../lib/phoneFiles'
import { loadSettings } from '../lib/settings'
import type { AddOptions, LazyFile } from './useImport'
import type { Confirm } from './useConfirm'
import { t } from '../i18n'

const MIN_GAP = 60_000
let lastAuto = 0
/** books the user said no to in an automatic offer: not asked about again until the app is opened next time */
const declined = new Set<string>()

/** the offer to read the phone's books is made once; after that, access is given from the settings */
const OFFERED_KEY = 'reader:deviceOffered'
function firstOffer(): boolean {
  try {
    if (localStorage.getItem(OFFERED_KEY)) return false
    localStorage.setItem(OFFERED_KEY, '1')
    return true
  } catch {
    return false // without storage the offer would come back every time
  }
}

type Deps = {
  addFiles: (files: LazyFile[], opts: AddOptions) => Promise<void>
  setBusy: (msg: string | undefined) => void
  setError: (msg: string | undefined) => void
  showToast: (msg: string, undo?: () => void, ms?: number) => void
  confirm: Confirm
}

/** Android app: adds the books in the phone's folders that the library hasn't seen yet, by itself when the app opens
 *  (once access was given) and when asked in the settings. Returns the on-demand scan. */
export function useDeviceScan({ addFiles, setBusy, setError, showToast, confirm }: Deps) {
  const running = useRef(false)

  const importNew = async (files: DeviceFile[]) => {
    await addFiles(
      files.map((f) => ({ name: f.name, devicePath: f.path, load: () => readDeviceFile(f) })),
      // remembered one by one, so an import cut short (the app closed) carries on with the rest next time
      { skipDuplicates: true, onEach: (i) => void markSeen([files[i]!]).catch((e) => console.warn('device scan: not remembered', e)) },
    )
  }

  const scan = async (manual: boolean, retry = false) => {
    if (running.current || !deviceBooksSupported()) return
    running.current = true
    try {
      if (!(await hasDeviceAccess())) {
        if (!manual && !firstOffer()) return
        const text = manual ? t('device.accessText') : `${t('device.offerText')} ${t('device.accessText')}`
        if (!(await confirm({ title: t('device.accessTitle'), text, ok: t('device.accessOk') }))) return
        if (!(await requestDeviceAccess())) {
          if (manual) setError(t('device.noAccess'))
          return
        }
        void requestNotificationAccess().then(() => syncBackgroundScan()) // so the background scan can announce what it finds
        manual = true // the user just chose this: show the progress and ask before adding, as from the settings
      }
      if (manual) setBusy(t('device.scanning'))
      const scanned = await scanDevice(loadSettings().deviceFolders)
      // books added before the library followed phone files get tied to theirs, quietly
      const linked = await linkKnownBooks(scanned).catch(() => 0)
      // the names of the books' files on the phone, and the system's index of them, are brought up to date: once
      // by itself, and every time it is asked for from the settings
      await (manual ? refreshPhoneFiles() : refreshPhoneFilesOnce()).catch(() => {})
      // a retry also offers the files whose adding was cancelled or failed before
      const all = await newDeviceFiles(scanned, retry ? await phoneFilePaths() : undefined)
      setBusy(undefined)
      const found = manual ? all : all.filter((f) => !declined.has(f.path))
      if (!found.length) {
        if (manual) showToast(linked ? t('device.linked', { n: linked }) : t('device.noneNew'), undefined, 4000)
        return
      }
      // never added by itself: whatever turns up, the user is asked first (a collection can be large, and PDFs take a while each)
      if (!(await confirm({ title: t('device.foundTitle'), text: t('device.foundText', { n: found.length }), ok: t('device.add') }))) {
        if (!manual) found.forEach((f) => declined.add(f.path))
        return
      }
      await importNew(found)
    } catch (e) {
      setBusy(undefined)
      // a failed automatic scan stays quiet: the books will be picked up next time or from the settings
      if (manual) setError(t('device.failed', { msg: e instanceof Error ? e.message : String(e) }))
      else console.warn('device scan failed', e)
    } finally {
      running.current = false
    }
  }

  const scanRef = useRef(scan)
  useEffect(() => {
    scanRef.current = scan
  })
  // when the app opens, and when it comes back to the front (a book was just downloaded), at most once a minute;
  // the library remounts each time a book is closed, so the time is kept outside the component.
  // Opened from the background scan's notification, it scans at once (and even with the automatic scan off),
  // since the user is there for the new books. Whenever the app comes or goes, the native background scan
  // (closed app, or open but not on the screen) is brought up to date with the folders and the known books.
  useEffect(() => {
    const auto = () => {
      if (document.visibilityState !== 'visible') {
        void syncBackgroundScan()
        return
      }
      const due = loadSettings().deviceAutoScan && Date.now() - lastAuto >= MIN_GAP
      if (due) lastAuto = Date.now()
      void consumeScanNotificationTap().then((tapped) => {
        if (!due && !tapped) return
        lastAuto = Date.now()
        void scanRef.current(false)
      })
      void syncBackgroundScan()
    }
    auto()
    document.addEventListener('visibilitychange', auto)
    return () => document.removeEventListener('visibilitychange', auto)
  }, [])

  return (retry = false) => scanRef.current(true, retry)
}
