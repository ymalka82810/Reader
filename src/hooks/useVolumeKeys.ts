import { useEffect, useLayoutEffect, useRef } from 'react'
import type { VolumeKeys } from '../lib/settings'

type Cap = {
  isNativePlatform?: () => boolean
  nativePromise?: (p: string, m: string, o?: object) => Promise<unknown>
  addListener?: (plugin: string, event: string, cb: (e: { key?: string }) => void) => { remove: () => void } | undefined
}
const getCap = () => (globalThis as unknown as { Capacitor?: Cap }).Capacitor

/** which way a volume key turns the page: 1 forward, -1 back */
export function volumeTurn(mode: VolumeKeys, key: string | undefined): 1 | -1 | 0 {
  if (mode === 'off' || (key !== 'up' && key !== 'down')) return 0
  const forward = mode === 'down-next' ? 'down' : 'up'
  return key === forward ? 1 : -1
}

/**
 * In the Android app, the volume keys turn pages while the reader is open and `active`. The native AppUpdater plugin
 * takes the keys only while asked (so outside the reader, and while reading aloud plays, they change the volume as usual).
 */
export function useVolumeKeys(mode: VolumeKeys, active: boolean, onTurn: (turn: 1 | -1) => void) {
  const cb = useRef(onTurn)
  const modeRef = useRef(mode)
  useLayoutEffect(() => {
    cb.current = onTurn
    modeRef.current = mode
  })
  const on = active && mode !== 'off'

  useEffect(() => {
    const cap = getCap()
    if (!on || !cap?.isNativePlatform?.() || !cap.addListener || !cap.nativePromise) return
    let listener: { remove: () => void } | undefined
    try {
      listener = cap.addListener('AppUpdater', 'volumeKey', (e) => {
        const turn = volumeTurn(modeRef.current, e?.key)
        if (turn) cb.current(turn)
      })
    } catch {
      return // an older APK without the event: the keys keep changing the volume
    }
    cap.nativePromise('AppUpdater', 'setVolumeKeys', { on: true }).catch(() => {})
    return () => {
      cap.nativePromise?.('AppUpdater', 'setVolumeKeys', { on: false }).catch(() => {})
      listener?.remove()
    }
  }, [on])
}
