// The voice behind reading aloud. In a browser it's the Web Speech API; in the Android app it's the native NativeTts
// plugin (resources/android-tts/NativeTtsPlugin.java), because Android's WebView has no speechSynthesis. The plugin
// also keeps reading with the screen off. Talks to it through the injected Capacitor bridge, so @capacitor/core
// isn't bundled.
import { getLocale, t } from '../i18n'

interface CapacitorBridge {
  isNativePlatform?: () => boolean
  isPluginAvailable?: (name: string) => boolean
  nativePromise: <T>(plugin: string, method: string, options?: object) => Promise<T>
}

const cap = () => (globalThis as unknown as { Capacitor?: CapacitorBridge }).Capacitor

export interface Voice {
  id: string
  label: string
  /** BCP 47 tag */
  lang: string
}

interface SpeakOptions {
  rate: number
  lang?: string
  /** a Voice id; the language's default voice when missing or no longer installed */
  voice?: string
}

/** why reading can't go on: no voice for the language, stopped from outside (notification, a call), no engine */
export type SpeechFailure = 'no-voice' | 'interrupted' | 'unavailable'

interface SpeechEngine {
  /** resolves once the text is spoken (or skipped over); rejects with a SpeechFailure code when reading can't go on */
  speak(text: string, o: SpeakOptions): Promise<void>
  cancel(): void
  voices(): Promise<Voice[]>
  /** a read-through starts: the Android app shows a notification and keeps reading with the screen off */
  begin(title: string): void
}

const NATIVE_CODES: Record<string, SpeechFailure> = { NO_VOICE: 'no-voice', INTERRUPTED: 'interrupted', UNAVAILABLE: 'unavailable' }

export const failureOf = (e: unknown): SpeechFailure | undefined =>
  typeof e === 'object' && e ? NATIVE_CODES[(e as { code?: string }).code ?? ''] : undefined

/** primary language subtag, with the old codes Android still reports for some locales */
function primaryLang(tag: string) {
  const p = tag.split(/[-_]/)[0]?.toLowerCase() ?? ''
  return ({ iw: 'he', in: 'id', ji: 'yi' } as Record<string, string>)[p] ?? p
}

export function languageName(tag: string, locale: string = getLocale()) {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** Android names voices like "he-il-x-heb-network": shown as the language, numbered when it has several */
export function nativeVoiceLabels(list: { id: string; lang: string; network: boolean }[]): Voice[] {
  const sorted = [...list].sort((a, b) => a.lang.localeCompare(b.lang) || Number(a.network) - Number(b.network) || a.id.localeCompare(b.id))
  const total = new Map<string, number>()
  for (const v of sorted) total.set(v.lang, (total.get(v.lang) ?? 0) + 1)
  const seen = new Map<string, number>()
  return sorted.map((v) => {
    const n = (seen.get(v.lang) ?? 0) + 1
    seen.set(v.lang, n)
    const name = languageName(v.lang) + ((total.get(v.lang) ?? 0) > 1 ? ` ${n}` : '')
    return { id: v.id, lang: v.lang, label: v.network ? `${name} · ${t('tts.online')}` : name }
  })
}

const nativeEngine = (c: CapacitorBridge): SpeechEngine => ({
  speak: (text, o) => c.nativePromise<void>('NativeTts', 'speak', { text, rate: o.rate, lang: o.lang ?? '', voice: o.voice ?? '' }),
  cancel: () => void c.nativePromise('NativeTts', 'stop').catch(() => {}),
  voices: async () => {
    const { voices } = await c.nativePromise<{ voices: { id: string; lang: string; network: boolean }[] }>('NativeTts', 'voices')
    return nativeVoiceLabels(voices)
  },
  begin: (title) => void c.nativePromise('NativeTts', 'begin', { title: title || t('tts.notice'), text: t('tts.notice'), stop: t('reader.ttsStop') }).catch(() => {}),
})

/** the browser's voices, which some browsers load only after the first call */
function webVoices(): Promise<SpeechSynthesisVoice[]> {
  const s: Partial<SpeechSynthesis> = speechSynthesis
  const now = s.getVoices?.() ?? []
  if (now.length || !s.addEventListener) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(speechSynthesis.getVoices())
    }
    speechSynthesis.addEventListener('voiceschanged', done)
    setTimeout(done, 1500)
  })
}

const webEngine: SpeechEngine = {
  speak: (text, o) =>
    new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = o.rate
      if (o.lang) u.lang = o.lang
      const voice = o.voice && (speechSynthesis as Partial<SpeechSynthesis>).getVoices?.().find((v) => v.voiceURI === o.voice)
      if (voice) u.voice = voice
      u.onend = u.onerror = () => resolve()
      speechSynthesis.speak(u)
    }),
  cancel: () => speechSynthesis.cancel(),
  voices: async () => (await webVoices()).map((v) => ({ id: v.voiceURI, label: v.name, lang: v.lang })),
  begin: () => {},
}

function pickEngine(): SpeechEngine | null {
  const c = cap()
  if (c?.isNativePlatform?.() && (c.isPluginAvailable?.('NativeTts') ?? true)) return nativeEngine(c)
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? webEngine : null
}

export const speechEngine = pickEngine()

/** the voices for a book in this language (all of them when its language is unknown) */
export function voicesFor(all: Voice[], lang: string) {
  const p = primaryLang(lang)
  return p ? all.filter((v) => primaryLang(v.lang) === p) : all
}

const VOICES_KEY = 'reader:tts-voices'

function loadVoices(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(VOICES_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** the voice chosen for a language, '' for its default */
export const loadVoice = (lang: string) => {
  const v = loadVoices()[primaryLang(lang)]
  return typeof v === 'string' ? v : ''
}

export function saveVoice(lang: string, id: string) {
  const all = loadVoices()
  if (id) all[primaryLang(lang)] = id
  else delete all[primaryLang(lang)]
  try {
    localStorage.setItem(VOICES_KEY, JSON.stringify(all))
  } catch {
    /* the voice just isn't remembered */
  }
}

const SAMPLES: Record<string, string> = {
  he: 'שלום, זה הקול שיקריא לך את הספר.',
  en: 'Hello, this is the voice that will read the book to you.',
}

/** a line to try a voice with, in the book's language: its own name for the language when there is no sample */
export function sampleText(lang: string) {
  const p = primaryLang(lang)
  return SAMPLES[p] ?? (p ? languageName(p, p) : SAMPLES.en!)
}
