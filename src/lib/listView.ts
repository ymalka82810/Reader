const KEY = 'reader.listView'

/** whether the library was last left in list view (grid is the default) */
export function readListView(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function saveListView(list: boolean) {
  try {
    localStorage.setItem(KEY, list ? '1' : '0')
  } catch {
    /* localStorage unavailable or full: the choice just won't persist */
  }
}
