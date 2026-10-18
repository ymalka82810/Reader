export type AppTheme = 'auto' | 'light' | 'dark'

const KEY = 'reader.appTheme'

/** the library's color scheme: 'auto' follows the system, the others override it */
export function loadAppTheme(): AppTheme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyAppTheme(theme: AppTheme) {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function saveAppTheme(theme: AppTheme) {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    /* localStorage unavailable or full: the choice just won't persist */
  }
  applyAppTheme(theme)
}
