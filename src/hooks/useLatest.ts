import { useLayoutEffect, useRef } from 'react'

/** a ref that always holds the latest rendered value, for event handlers and effects that must not re-run on it */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
