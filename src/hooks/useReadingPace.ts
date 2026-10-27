import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { FoliateView } from 'foliate-js/view.js'
import { estimatePace, linearSizes } from '../lib/pace'
import type { Stats } from '../lib/stats'
import { countWords } from '../lib/wordCount'

/** sections read so far must hold this many words before they stand in for the book's word count */
const MIN_SAMPLE_WORDS = 300

/**
 * The reading pace of the open book (lib/pace). The book's word count comes from the library; a book not counted yet
 * is estimated from the sections the reader has opened (their words against their bytes).
 */
export function useReadingPace(id: string, viewRef: MutableRefObject<FoliateView | null>) {
  const words = useRef<number | null>(null)
  const sampled = useRef(new Map<number, number>())
  useEffect(() => {
    words.current = null
    sampled.current = new Map()
  }, [id])

  return useMemo(() => {
    const sizes = () => linearSizes(viewRef.current?.book?.sections ?? [])
    const totalBytes = () => sizes().reduce((a, b) => a + b, 0)
    const wordsInBook = (): number | null => {
      if (words.current) return words.current
      const s = sizes()
      let bytes = 0
      let w = 0
      for (const [i, n] of sampled.current) {
        if (!s[i]) continue
        bytes += s[i]!
        w += n
      }
      const total = s.reduce((a, b) => a + b, 0)
      return w >= MIN_SAMPLE_WORDS && bytes > 0 ? Math.round((total * w) / bytes) : null
    }
    return {
      /** the word count the library holds for the book (undefined while it isn't counted) */
      setWords: (n: number | undefined) => {
        words.current = n && n > 0 ? n : null
      },
      /** counts the words of a section as foliate loads it */
      sample: (doc: Document, index: number) => {
        if (!sampled.current.has(index)) sampled.current.set(index, countWords(doc.body?.textContent ?? ''))
      },
      wordsInBook,
      /** seconds per KB in this book, from its reading so far (`stats`) and the personal pace */
      secsPerKB: (stats: Stats) => estimatePace({ stats, totalBytes: totalBytes(), words: wordsInBook() }),
    }
  }, [viewRef])
}
