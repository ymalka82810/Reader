import type { KeyboardEvent } from 'react'

const ITEMS = '[role^="menuitem"]:not(:disabled)'

/** keyboard handling of a role="menu": Up/Down/Home/End move between the items, Escape closes */
export function menuKeyDown(e: KeyboardEvent<HTMLElement>, onEscape: () => void) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    return onEscape()
  }
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)]
  if (!items.length) return
  const i = items.indexOf(document.activeElement as HTMLElement)
  let next: HTMLElement | undefined
  if (e.key === 'ArrowDown') next = items[i + 1] ?? items[0]
  else if (e.key === 'ArrowUp') next = items[i < 1 ? items.length - 1 : i - 1]
  else if (e.key === 'Home') next = items[0]
  else if (e.key === 'End') next = items[items.length - 1]
  else return
  e.preventDefault()
  next?.focus()
}
