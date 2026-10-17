import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FoliateView } from 'foliate-js/view.js'
import { isEyeMessage, type EyeCommand, type EyeStatus } from '../lib/eyeProtocol'
import type { GazeMove } from '../lib/gaze'
import type { Flow } from '../lib/settings'
import { useLatest } from './useLatest'

export type { EyeStatus }

/** in scrolled mode one look scrolls this share of the screen */
const SCROLL_SHARE = 0.6

interface Deps {
  enabled: boolean
  viewRef: MutableRefObject<FoliateView | null>
  flow: Flow
  /** a panel or the bars are up: the reader is looking at them, not at the text */
  paused: boolean
  markActive: () => void
}

/**
 * Turns the page, or scrolls, when the reader keeps looking at the bottom (forward) or top (back) of the
 * screen. The front camera and the face model run on the device in a hidden iframe (eye.html, which has its
 * own content-security policy); nothing is recorded or sent anywhere. The first two seconds after starting
 * calibrate "looking straight ahead", so keep your eyes on the text.
 */
export function useEyeScroll(deps: Deps) {
  const d = useLatest(deps)
  const { enabled } = deps
  const [status, setStatus] = useState<EyeStatus>('off')
  const frame = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    const iframe = document.createElement('iframe')
    iframe.src = new URL('eye.html', document.baseURI).href
    iframe.allow = 'camera'
    iframe.title = 'זיהוי מבט'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0'
    frame.current = iframe

    const act = (move: GazeMove) => {
      const view = d.current.viewRef.current
      if (!view) return
      d.current.markActive()
      const down = move === 'down'
      if (d.current.flow === 'paginated') void (down ? view.next() : view.prev())
      else void (down ? view.renderer.next(view.renderer.size * SCROLL_SHARE) : view.renderer.prev(view.renderer.size * SCROLL_SHARE))
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.origin !== location.origin || !isEyeMessage(e.data)) return
      if (e.data.type === 'status') setStatus(e.data.status)
      else if (!d.current.paused) act(e.data.move)
    }
    window.addEventListener('message', onMessage)
    document.body.append(iframe)

    return () => {
      window.removeEventListener('message', onMessage)
      iframe.remove() // closing its document also stops the camera
      frame.current = null
      setStatus('off')
    }
  }, [enabled, d])

  const recalibrate = useCallback(() => {
    const cmd: EyeCommand = { source: 'reader', type: 'recalibrate' }
    frame.current?.contentWindow?.postMessage(cmd, location.origin)
    setStatus((s) => (s === 'active' ? 'calibrating' : s))
  }, [])

  return { status: enabled ? (status === 'off' ? 'starting' : status) : ('off' as const), recalibrate }
}
