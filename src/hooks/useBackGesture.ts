import { useEffect, useLayoutEffect, useRef } from 'react'

/** marks the one history entry the app keeps on top of the page it was opened on */
const SENTINEL = 'readerBack'

const hasSentinel = () => (history.state as Record<string, unknown> | null)?.[SENTINEL] === true

type Entry = { cb: { current: () => void }; level: number }
const entries: Entry[] = []
let installed = false

function onPop() {
  // the back gesture popped the sentinel: put it back at once so the app is never left by accident,
  // then let the innermost screen decide what "back" means
  if (hasSentinel()) return
  history.pushState({ [SENTINEL]: true }, '')
  let top: Entry | undefined
  for (const e of entries) if (!top || e.level >= top.level) top = e
  top?.cb.current()
}

function install() {
  if (installed) return
  installed = true
  // after a reload the entry is still there
  if (!hasSentinel()) history.pushState({ [SENTINEL]: true }, '')
  window.addEventListener('popstate', onPop)
}

/**
 * Turns the phone's back gesture (and the browser's back button) into a callback while mounted.
 * The app keeps a single guard entry in the history and restores it after every back, so a back never
 * leaves the app on its own: it only calls `onBack` of the innermost screen (the highest `level`, the
 * most recently mounted among equals), which closes one layer. Screens close themselves normally, with
 * no history bookkeeping.
 */
export function useBackGesture(onBack: () => void, level = 0) {
  const cb = useRef(onBack)
  useLayoutEffect(() => {
    cb.current = onBack
  })

  useEffect(() => {
    install()
    const entry: Entry = { cb, level }
    entries.push(entry)
    return () => {
      entries.splice(entries.indexOf(entry), 1)
    }
  }, [level])
}

/** leaves the app for real: closes the Android app, or steps back past the guard entry in a browser */
export function exitApp() {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean; nativePromise?: (p: string, m: string) => Promise<unknown> } }).Capacitor
  if (cap?.isNativePlatform?.() && cap.nativePromise) {
    cap.nativePromise('AppUpdater', 'exitApp').catch(() => {})
    return
  }
  history.go(-2)
}
