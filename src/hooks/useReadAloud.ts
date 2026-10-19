import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'
import { failureOf, loadVoice, speechEngine, type SpeechFailure } from '../lib/speech'

const RATE_KEY = 'reader:tts-rate'
export const MIN_RATE = 0.5
export const MAX_RATE = 2.5
export const RATE_STEP = 0.1
const HIGHLIGHT = '#ffd54f'

export const readAloudSupported = !!speechEngine

const clampRate = (r: number) => Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, r)) * 10) / 10

function loadRate() {
  try {
    const r = parseFloat(localStorage.getItem(RATE_KEY) ?? '')
    return Number.isFinite(r) ? clampRate(r) : 1
  } catch {
    return 1
  }
}

/** splits foliate's SSML for one block into sentence-sized pieces, each tagged with its mark name */
function segments(ssml: string): { mark?: string; text: string }[] {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml')
  const out: { mark?: string; text: string }[] = []
  let cur: { mark?: string; text: string } = { text: '' }
  const flush = () => {
    if (cur.text.trim()) out.push(cur)
  }
  const walk = (node: Node) => {
    if (node.nodeType === 3 || node.nodeType === 4) cur.text += node.textContent ?? ''
    else if (node.nodeType === 1 && (node as Element).localName === 'mark') {
      flush()
      cur = { mark: (node as Element).getAttribute('name') ?? undefined, text: '' }
    }
    node.childNodes.forEach(walk)
  }
  walk(doc.documentElement)
  flush()
  return out
}

/** the language to read the book in: the reader's guess wins over the book's metadata ('' when unknown) */
const bookLanguage = (view: FoliateView | null, guess: string): string =>
  guess || [view?.book.metadata?.language].flat()[0] || ''

interface Deps {
  viewRef: MutableRefObject<FoliateView | null>
  lastDetail: MutableRefObject<FoliateRelocateDetail | null>
  /** primary language subtag of the book, '' when unknown */
  lang: MutableRefObject<string>
  /** shown in the Android app's notification while reading */
  title?: string
  /** the reading stopped on its own for this reason */
  onFail?: (why: SpeechFailure) => void
}

/**
 * Reads the book aloud with the device's speech synthesis (the Web Speech API, or Android's own in the app),
 * sentence by sentence from the top of the screen, highlighting the sentence being spoken and following it
 * across sections, in the voice chosen for the book's language.
 */
export function useReadAloud({ viewRef, lastDetail, lang, title, onFail }: Deps) {
  const [active, setActive] = useState(false)
  const [rate, setRateState] = useState(loadRate)
  const rateRef = useRef(rate)
  /** bumped to cancel the running read-through */
  const run = useRef(0)
  const marked = useRef<string | null>(null)

  const clearMark = useCallback(() => {
    if (marked.current) viewRef.current?.deleteAnnotation({ value: marked.current }).catch(() => {})
    marked.current = null
  }, [viewRef])

  const stop = useCallback(() => {
    run.current++
    speechEngine?.cancel()
    clearMark()
    setActive(false)
  }, [clearMark])

  const setRate = useCallback((r: number) => {
    const next = clampRate(r)
    rateRef.current = next
    setRateState(next)
    try {
      localStorage.setItem(RATE_KEY, String(next))
    } catch {
      /* the rate just isn't remembered */
    }
  }, [])

  const toggle = useCallback(async () => {
    if (active) return stop()
    const view = viewRef.current
    const engine = speechEngine
    if (!view || !engine) return
    const id = ++run.current
    const live = () => id === run.current
    setActive(true)
    engine.begin(title ?? '')
    try {
      let index = lastDetail.current?.section?.current ?? 0
      const total = lastDetail.current?.section?.total ?? view.book.sections.length
      const init = () =>
        view.initTTS('sentence', (range: Range) => {
          clearMark()
          const cfi = view.getCFI(index, range)
          marked.current = cfi
          view.addAnnotation({ value: cfi, color: HIGHLIGHT }).catch(() => {})
          view.renderer.scrollToAnchor?.(range)
        })
      await init()
      const here = lastDetail.current?.range
      let ssml: string | undefined = here ? view.tts.from(here) : view.tts.start()
      while (live()) {
        if (!ssml) {
          // end of the section: carry on in the next one
          if (index + 1 >= total) break
          index++
          await view.goTo(index)
          if (!live()) break
          await init()
          ssml = view.tts.start()
          continue
        }
        for (const seg of segments(ssml)) {
          if (!live()) break
          if (seg.mark) view.tts.setMark(seg.mark)
          const code = bookLanguage(view, lang.current)
          // read for every sentence, so a voice picked meanwhile is heard from the next one
          await engine.speak(seg.text, { rate: rateRef.current, lang: code || undefined, voice: loadVoice(code) || undefined })
        }
        if (live()) ssml = view.tts.next()
      }
    } catch (e) {
      const why = failureOf(e)
      if (why && live()) onFail?.(why)
      else if (!why) console.error(e)
    }
    if (live()) stop()
  }, [active, stop, viewRef, lastDetail, lang, title, onFail, clearMark])

  // leaving the book silences it
  useEffect(() => stop, [stop])

  return { active, toggle, rate, setRate }
}
