import { useRef, useState } from 'react'

export type Toast = { msg: string; undo?: () => void }

export function useToast() {
  const [toast, setToast] = useState<Toast>()
  const timer = useRef<number>(undefined)

  const showToast = (msg: string, undo?: () => void, ms = 4000) => {
    window.clearTimeout(timer.current)
    setToast({ msg, undo })
    timer.current = window.setTimeout(() => setToast(undefined), ms)
  }
  const clearToast = () => {
    window.clearTimeout(timer.current)
    setToast(undefined)
  }

  return { toast, showToast, clearToast }
}
