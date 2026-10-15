import { useEffect, useRef, type HTMLAttributes } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** a dialog container: takes focus on open, keeps Tab inside, and hands focus back to the opener on close */
export function Dialog(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  // read during the first render, before an autoFocus child has stolen focus from the opener
  const openerRef = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    const el = ref.current
    const opener = openerRef.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(e)
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
    if (!items.length) return e.preventDefault()
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
  return <div tabIndex={-1} {...props} ref={ref} onKeyDown={onKeyDown} />
}
