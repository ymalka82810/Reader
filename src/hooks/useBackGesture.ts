import { useEffect, useLayoutEffect, useRef } from 'react'

/** marks the one history entry the app keeps on top of the page it was opened on */
const SENTINEL = 'readerBack'

const hasSentinel = () => (history.state as Record<string, unknown> | null)?.[SENTINEL] === true

type Cap = {
  isNativePlatform?: () => boolean
  nativePromise?: (p: string, m: string) => Promise<unknown>
  addListener?: (plugin: string, event: string, cb: () => void) => unknown
}
const getCap = () => (globalThis as unknown as { Capacitor?: Cap }).Capacitor
const isNative = () => !!getCap()?.isNativePlatform?.()

type Entry = { cb: { current: () => void }; level: number }
const entries: Entry[] = []
let installed = false

/** "back" means: let the innermost screen close one layer */
function runBack() {
  let top: Entry | undefined
  for (const e of entries) if (!top || e.level >= top.level) top = e
  top?.cb.current()
}

function onPop() {
  // the back gesture popped the sentinel: put it back at once so the app is never left by accident,
  // then let the innermost screen decide what "back" means
  if (hasSentinel()) return
  history.pushState({ [SENTINEL]: true }, '')
  runBack()
}

/** a history entry added without a tap is skipped by Chrome/WebView on back, so (re)add it on a real tap */
function onGesture() {
  if (!hasSentinel()) history.pushState({ [SENTINEL]: true }, '')
}

function install() {
  if (installed) return
  installed = true
  const cap = getCap()
  if (isNative() && cap?.addListener) {
    // In the Android app the system back gesture comes straight from the native AppUpdater plugin as a
    // "back" event; the app itself never closes on back (only exitApp() does, after the library asks).
    try {
      cap.addListener('AppUpdater', 'back', runBack)
      return
    } catch {
      /* older app without the event: fall back to the history guard below */
    }
  }
  // after a reload the entry is still there
  if (!hasSentinel()) history.pushState({ [SENTINEL]: true }, '')
  window.addEventListener('popstate', onPop)
  window.addEventListener('pointerdown', onGesture, true)
  window.addEventListener('keydown', onGesture, true)
}

/**
 * Turns the phone's back gesture (and the browser's back button) into a callback while mounted and `active`.
 * A back never leaves the app on its own: it only calls `onBack` of the innermost screen (the highest
 * `level`, the most recently mounted among equals), which closes one layer.
 */
export function useBackGesture(onBack: () => void, level = 0, active = true) {
  const cb = useRef(onBack)
  useLayoutEffect(() => {
    cb.current = onBack
  })

  useEffect(() => {
    install()
    if (!active) return
    const entry: Entry = { cb, level }
    entries.push(entry)
    return () => {
      entries.splice(entries.indexOf(entry), 1)
    }
  }, [level, active])
}

/** leaves the app for real: closes the Android app, or steps back past the guard entry in a browser */
export function exitApp() {
  const cap = getCap()
  if (isNative() && cap?.nativePromise) {
    cap.nativePromise('AppUpdater', 'exitApp').catch(() => {})
    return
  }
  window.removeEventListener('popstate', onPop)
  history.go(-2)
}
