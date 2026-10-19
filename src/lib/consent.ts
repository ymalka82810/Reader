/** external services that receive text from the user's books; each needs an explicit yes before the first request */
export type Service = 'translate' | 'dict' | 'books'

/** the host that gets the text, shown in the consent notice */
export const SERVICE_HOST: Record<Service, string> = {
  translate: 'api.mymemory.translated.net (MyMemory) / translate.googleapis.com (Google Translate) / lingva.ml (Lingva)',
  dict: 'wiktionary.org',
  books: 'www.googleapis.com (Google Books)',
}

/** translate is "v3": earlier yeses did not cover Lingva, which can now receive the text too */
const key = (s: Service) => `reader:consent:${s === 'translate' ? 'translate3' : s}`

export function hasConsent(s: Service): boolean {
  try {
    return localStorage.getItem(key(s)) === '1'
  } catch {
    return false
  }
}

export function setConsent(s: Service, on: boolean) {
  try {
    if (on) localStorage.setItem(key(s), '1')
    else localStorage.removeItem(key(s))
  } catch {
    /* storage unavailable: the question is simply asked again next time */
  }
}
