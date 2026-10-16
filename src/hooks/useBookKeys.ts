import type { FoliateView } from 'foliate-js/view.js'
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'

type KeyPanel = 'toc' | 'notes' | 'settings' | 'search'

export interface KeyActions {
  bookmark: () => void
  gotoBookmark: (dir: 1 | -1) => void
  bump: (delta: number) => void
  panel: (p: KeyPanel) => void
  hideBars: () => void
  /** start / stop auto-reading */
  autoRead: () => void
  pace: (faster: boolean) => void
}

interface Deps {
  viewRef: MutableRefObject<FoliateView | null>
  actions: MutableRefObject<KeyActions>
  closePanel: () => void
  markActive: () => void
}

/**
 * Keyboard shortcuts for the reader. Listens on the window and returns the same stable
 * handler so it can also be attached to each book iframe (keys pressed there don't reach the window).
 */
export function useBookKeys(deps: Deps) {
  const d = useRef(deps)
  useLayoutEffect(() => {
    d.current = deps
  })

  const onKey = useCallback((e: KeyboardEvent) => {
    const { viewRef, actions, closePanel, markActive } = d.current
    const v = viewRef.current
    if (!v) return
    const t = e.target as HTMLElement | null
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    markActive()
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const a = actions.current
    if (e.key === 'ArrowLeft') {
      a.hideBars()
      v.goLeft()
    } else if (e.key === 'ArrowRight') {
      a.hideBars()
      v.goRight()
    } else if (e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault()
      a.hideBars()
      v.next()
    } else if (e.key === 'PageUp') {
      a.hideBars()
      v.prev()
    }
    else if (e.key === 'Escape') closePanel()
    else if (e.key === '+' || e.key === '=') a.bump(2)
    else if (e.key === '-') a.bump(-2)
    else if (e.code === 'KeyB') a.bookmark()
    else if (e.code === 'BracketRight') a.gotoBookmark(1)
    else if (e.code === 'BracketLeft') a.gotoBookmark(-1)
    else if (e.code === 'KeyT') a.panel('toc')
    else if (e.code === 'KeyN') a.panel('notes')
    else if (e.code === 'KeyS') a.panel('settings')
    else if (e.code === 'KeyA') a.autoRead()
    else if (e.code === 'Period') a.pace(true)
    else if (e.code === 'Comma') a.pace(false)
    else if (e.key === '/' || e.code === 'Slash') {
      e.preventDefault()
      a.panel('search')
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  return onKey
}
