import { useEffect, useState } from 'react'
import { isNight } from '../lib/nightMode'
import type { Settings } from '../lib/settings'

/** whether night mode is on right now; checked again every half minute and when the app comes back on screen */
export function useNightMode(s: Pick<Settings, 'nightMode' | 'nightStart' | 'nightEnd'>): boolean {
  const { nightMode, nightStart, nightEnd } = s
  const check = () => isNight({ nightMode, nightStart, nightEnd })
  const [night, setNight] = useState(check)
  useEffect(() => {
    const update = () => setNight(isNight({ nightMode, nightStart, nightEnd }))
    update()
    if (nightMode === 'off') return
    const timer = window.setInterval(update, 30_000)
    const onShow = () => document.visibilityState === 'visible' && update()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [nightMode, nightStart, nightEnd])
  return night
}
