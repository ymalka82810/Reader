import { useEffect, useRef } from 'react'
import {
  deviceBooksSupported,
  hasDeviceAccess,
  markSeen,
  newDeviceFiles,
  readDeviceFile,
  requestDeviceAccess,
  scanDevice,
  type DeviceFile,
} from '../lib/deviceBooks'
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
      files.map((f) => ({ name: f.name, load: () => readDeviceFile(f) })),
      // remembered one by one, so an import cut short (the app closed) carries on with the rest next time
      { skipDuplicates: true, onEach: (i) => void markSeen([files[i]!]).catch((e) => console.warn('device scan: not remembered', e)) },
    )
  }

  const scan = async (manual: boolean) => {
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
        manual = true // the user just chose this: show the progress and ask before adding, as from the settings
      }
      if (manual) setBusy(t('device.scanning'))
      const all = await newDeviceFiles(await scanDevice(loadSettings().deviceFolders))
      setBusy(undefined)
      const found = manual ? all : all.filter((f) => !declined.has(f.path))
      if (!found.length) {
        if (manual) showToast(t('device.noneNew'), undefined, 4000)
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
  // the library remounts each time a book is closed, so the time is kept outside the component
  useEffect(() => {
    const auto = () => {
      if (document.visibilityState !== 'visible' || !loadSettings().deviceAutoScan || Date.now() - lastAuto < MIN_GAP) return
      lastAuto = Date.now()
      void scanRef.current(false)
    }
    auto()
    document.addEventListener('visibilitychange', auto)
    return () => document.removeEventListener('visibilitychange', auto)
  }, [])

  return () => scanRef.current(true)
}
