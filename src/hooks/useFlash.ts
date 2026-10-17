import { useCallback, useEffect, useRef, useState } from 'react'

/** a short plain-text message that clears itself */
export function useFlash(ms = 1800) {
  const [message, setMessage] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const flash = useCallback(
    (msg: string) => {
      setMessage(msg)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMessage(''), ms)
    },
    [ms],
  )
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { message, flash }
}
