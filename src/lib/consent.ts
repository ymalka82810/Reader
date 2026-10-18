/** external services that receive text the user selected; each needs an explicit yes before the first request */
export type Service = 'translate' | 'dict'

/** the host that gets the text, shown in the consent notice */
export const SERVICE_HOST: Record<Service, string> = {
  translate: 'api.mymemory.translated.net (MyMemory) / translate.googleapis.com (Google Translate)',
  dict: 'wiktionary.org',
}

/** translate is "v2": the earlier yes covered MyMemory only, and Google can now receive the text too */
const key = (s: Service) => `reader:consent:${s === 'translate' ? 'translate2' : s}`

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
