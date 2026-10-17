// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { menuKeyDown } from './menuKeys'

function Menu({ onEscape }: { onEscape: () => void }) {
  return (
    <div role="menu" onKeyDown={(e) => menuKeyDown(e, onEscape)}>
      <button role="menuitem">one</button>
      <button role="menuitem" disabled>skipped</button>
      <button role="menuitemcheckbox" aria-checked="false">two</button>
    </div>
  )
}

afterEach(cleanup)

describe('menuKeyDown', () => {
  it('moves between enabled items with the arrows, wrapping around', () => {
    render(<Menu onEscape={() => {}} />)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('one'))
    fireEvent.keyDown(screen.getByText('one'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('two'))
    fireEvent.keyDown(screen.getByText('two'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('one'))
    fireEvent.keyDown(screen.getByText('one'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByText('two'))
    fireEvent.keyDown(screen.getByText('two'), { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByText('one'))
  })

  it('closes on Escape', () => {
    const onEscape = vi.fn()
    render(<Menu onEscape={onEscape} />)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledOnce()
  })
})
