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

/** eye scrolling is built but switched off in the UI until the gaze detection works reliably */
export const EYE_SCROLL_AVAILABLE = false

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

/** most columns the paginator may use side by side (it still falls back to one on a narrow or portrait screen) */
export const maxColumns = (s: Spread) => (s === 'single' ? '1' : '2')

/** column width that lets two columns fit on tablets, used by 'double' when the reader set no width of their own */
export const DOUBLE_COLUMN_WIDTH = 480
