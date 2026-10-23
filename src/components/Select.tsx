import { useEffect, useId, useRef, useState } from 'react'
import { useBackGesture } from '../hooks/useBackGesture'

type Props<T extends string> = {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  label?: string
  className?: string
}

/** themed replacement for the native <select>, whose popup can't be styled */
export function Select<T extends string>({ value, options, onChange, label, className }: Props<T>) {
  const [open, setOpen] = useState(false)
  // the phone's back swipe closes the open menu first
  useBackGesture(() => setOpen(false), 3, open)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const current = options.find(([v]) => v === value)

  const toggle = () => {
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e.target instanceof Node && (btn.current?.contains(e.target) || list.current?.contains(e.target))) return
      setOpen(false)
    }
    // only a scroll that can actually move the button (the page or one of its ancestors) closes the menu;
    // scrolling something unrelated, like the auto-advancing "continue reading" carousel, must leave it open
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && !e.target.contains(btn.current)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', key, true)
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])

  const pick = (v: T) => {
    setOpen(false)
    btn.current?.focus()
    if (v !== value) onChange(v)
  }

  const move = (e: React.KeyboardEvent<HTMLElement>) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const i = items.indexOf(e.currentTarget)
    if (e.key === 'ArrowDown') items[Math.min(i + 1, items.length - 1)]?.focus()
    else if (e.key === 'ArrowUp') items[Math.max(i - 1, 0)]?.focus()
    else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`select-btn ${className ?? ''}`}
        aria-label={`${label}: ${current?.[1] ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        <span>{current?.[1] ?? value}</span>
        <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
          <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul ref={list} id={id} role="listbox" className="select-list" style={{ top: pos.top, left: pos.left, minWidth: pos.width }}>
          {options.map(([v, text]) => (
            <li
              key={v}
              role="option"
              tabIndex={-1}
              aria-selected={v === value}
              onClick={() => pick(v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  pick(v)
                } else move(e)
              }}
            >
              {text}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
