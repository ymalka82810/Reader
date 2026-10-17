/** how many text columns a paginated page shows: 'auto' follows the screen, 'double' wants two even on narrower screens */
export type Spread = 'auto' | 'single' | 'double'
export type OrientationLock = 'free' | 'portrait' | 'landscape'

export interface ViewModes {
  spread: Spread
  /** distraction-free: full screen, bars come only briefly on a middle tap, no hints */
  focus: boolean
  orientation: OrientationLock
  /** scroll / turn the page by looking at the bottom or top of the screen (front camera) */
  eyeScroll: boolean
}

const DEFAULTS: ViewModes = { spread: 'auto', focus: false, orientation: 'free', eyeScroll: false }

const KEY = 'reader:viewModes'

export function loadViewModes(): ViewModes {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

export function saveViewModes(m: ViewModes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* localStorage unavailable or full: the modes just won't persist */
  }
}

/** foliate paginator attributes that produce the wanted number of columns */
export function spreadAttrs(s: Spread): { 'max-column-count': string; 'max-inline-size': string } {
  if (s === 'single') return { 'max-column-count': '1', 'max-inline-size': '720px' }
  if (s === 'double') return { 'max-column-count': '2', 'max-inline-size': '480px' }
  return { 'max-column-count': '2', 'max-inline-size': '720px' }
}
