import { applyAppTheme, loadAppTheme } from './appTheme'
import { loadSettings, type Settings, type Theme } from './settings'
import { deviceCoords, sunTimes } from './sun'

export type NightMode = 'off' | 'schedule' | 'sun'
export type NightTheme = Exclude<Theme, 'light'>

type NightSettings = Pick<Settings, 'nightMode' | 'nightStart' | 'nightEnd'>

/** "HH:MM" → minutes since midnight; a malformed value counts as midnight */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  return m ? (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60) : 0
}

/** is it night now by the user's choice: between the two set hours (across midnight too), or between sunset and sunrise */
export function isNight(s: NightSettings, now = new Date(), coords?: [number, number]): boolean {
  if (s.nightMode === 'schedule') {
    const start = toMinutes(s.nightStart)
    const end = toMinutes(s.nightEnd)
    const cur = now.getHours() * 60 + now.getMinutes()
    if (start === end) return false
    return start < end ? cur >= start && cur < end : cur >= start || cur < end
  }
  if (s.nightMode === 'sun') {
    const [lat, lon] = coords ?? deviceCoords()
    const sun = sunTimes(now, lat, lon)
    if (sun.kind !== 'normal') return sun.kind === 'night'
    return now < sun.rise || now >= sun.set
  }
  return false
}

/** the settings the book is shown with: at night the night theme replaces the chosen one */
export const shownSettings = (s: Settings, night: boolean): Settings => (night ? { ...s, theme: s.nightTheme } : s)

/** the library follows night mode too, when its own appearance is left to the system */
export function applyNightAppTheme(now = new Date()) {
  const app = loadAppTheme()
  if (app === 'auto' && isNight(loadSettings(), now)) document.documentElement.setAttribute('data-theme', 'dark')
  else applyAppTheme(app)
}

export const SETTINGS_EVENT = 'reader:settings'

/** keep the library's look in step with the clock: every half minute, when the app comes back on screen,
 *  and whenever a setting changes */
export function watchNightAppTheme() {
  const update = () => applyNightAppTheme()
  update()
  window.setInterval(update, 30_000)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update())
  window.addEventListener(SETTINGS_EVENT, update)
}
