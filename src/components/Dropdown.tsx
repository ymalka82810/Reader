import { useEffect, useId, useRef, useState } from 'react'
import { useBackGesture } from '../hooks/useBackGesture'

interface Props<T extends string> {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}

export function Dropdown<T extends string>({ value, options, onChange, label }: Props<T>) {
  const [open, setOpen] = useState(false)
  // the phone's back swipe closes the open menu first
  useBackGesture(() => setOpen(false), 3, open)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true })
  }, [open])

  const current = options.find((o) => o.value === value)

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }
  const pick = (v: T) => {
    onChange(v)
    close(true)
  }

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      show()
    }
  }

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1
    switch (e.key) {
      case 'ArrowDown': setActive((i) => Math.min(i + 1, last)); break
      case 'ArrowUp': setActive((i) => Math.max(i - 1, 0)); break
      case 'Home': setActive(0); break
      case 'End': setActive(last); break
      case 'Enter':
      case ' ': {
        const o = options[active]
        if (o) pick(o.value)
        break
      }
      case 'Escape': close(true); break
      case 'Tab': close(false); return
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
        const ch = e.key.toLowerCase()
        const n = options.length
        for (let k = 1; k <= n; k++) {
          const i = (active + k) % n
          if (options[i]!.label.toLowerCase().startsWith(ch)) {
            setActive(i)
            break
          }
        }
        return
      }
    }
    // keep Esc/arrows from reaching a surrounding dialog or page handler
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="dd" ref={ref}>
      <button ref={btnRef} type="button" className="dd-btn" aria-label={`${label}: ${current?.label ?? ''}`} aria-haspopup="listbox" aria-expanded={open} onKeyDown={onButtonKey} onClick={() => (open ? close(false) : show())}>
        <span>{current?.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul ref={listRef} className="dd-list" role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={`${id}-${active}`} onKeyDown={onListKey}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`${o.value === value ? 'on' : ''}${i === active ? ' active' : ''}`.trim()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              <span>{o.label}</span>
              {o.value === value && <span aria-hidden="true">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
