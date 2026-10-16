import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/** marks the history entry pushed while a book is open */
const GUARD = 'readerBook'

const guarded = () => (history.state as Record<string, unknown> | null)?.[GUARD] === true

/**
 * Turns the phone's back gesture (and the browser's back button) into a callback while mounted.
 * A history entry is pushed on open; each back pops it and calls `onBack`. If it returns true the
 * entry is pushed again (stay); if false it stays popped (the caller is leaving).
 * Returns `leave`, to call when closing another way, so the pushed entry doesn't linger.
 */
export function useBackGesture(onBack: () => boolean) {
  const cb = useRef(onBack)
  useLayoutEffect(() => {
    cb.current = onBack
  })

  useEffect(() => {
    // after a reload the entry is still there
    if (!guarded()) history.pushState({ [GUARD]: true }, '')
    const onPop = () => {
      if (cb.current()) history.pushState({ [GUARD]: true }, '')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return useCallback(() => {
    if (guarded()) history.back()
  }, [])
}
