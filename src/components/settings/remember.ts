const KEY = 'reader:settingsPage'

/** the settings screen is open in this tab (on this page, '' for the list), so a reload puts the user back where they were */
export function rememberedSettings(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function rememberSettings(page: string) {
  try {
    sessionStorage.setItem(KEY, page)
  } catch {
    /* storage unavailable: a reload just lands in the library */
  }
}

export function forgetSettings() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: a reload just lands in the library */
  }
}
