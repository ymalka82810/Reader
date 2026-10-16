import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FoliateView } from 'foliate-js/view.js'

export interface SearchGroup {
  label: string
  items: { cfi: string; excerpt: { pre: string; match: string; post: string } }[]
}

/** a one-letter query in a big book would otherwise flood state and the DOM */
export const MAX_SEARCH_RESULTS = 200

/** Full-text search over the open book. The scan stops when `active` turns false or the component unmounts. */
export function useBookSearch(viewRef: MutableRefObject<FoliateView | null>, active: boolean) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchGroup[]>([])
  const [searching, setSearching] = useState(false)
  const [capped, setCapped] = useState(false)
  const token = useRef(0)

  /** cancels a running search: its loop sees the stale token and stops pulling results */
  const cancel = useCallback(() => {
    token.current++
    setSearching(false)
  }, [])

  const run = useCallback(
    async (q: string) => {
      const view = viewRef.current
      const mine = ++token.current
      setCapped(false)
      if (!view || !q.trim()) {
        view?.clearSearch()
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      setResults([])
      let count = 0
      try {
        // returning from the loop calls the generator's return(), which stops the scan
        for await (const r of view.search({ query: q })) {
          if (mine !== token.current) return
          if (r === 'done') break
          if (!r.subitems) continue
          const items = r.subitems.slice(0, MAX_SEARCH_RESULTS - count)
          count += items.length
          setResults((prev) => [...prev, { label: r.label, items }])
          if (count >= MAX_SEARCH_RESULTS) {
            setCapped(true)
            break
          }
        }
      } finally {
        if (mine === token.current) setSearching(false)
      }
    },
    [viewRef],
  )

  // stop scanning when the search panel closes or the reader unmounts
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- cancelling a search resets its UI state
    if (!active) cancel()
  }, [active, cancel])
  useEffect(() => cancel, [cancel])

  return { query, setQuery, results, searching, capped, run, cancel }
}
