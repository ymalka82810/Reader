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

const FOLDERS_KEY = 'reader.foldersFirst'

/** whether folders are listed above the single books (the default) rather than below them */
export function readFoldersFirst(): boolean {
  try {
    return localStorage.getItem(FOLDERS_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveFoldersFirst(first: boolean) {
  try {
    localStorage.setItem(FOLDERS_KEY, first ? '1' : '0')
  } catch {
    /* localStorage unavailable or full: the choice just won't persist */
  }
}
