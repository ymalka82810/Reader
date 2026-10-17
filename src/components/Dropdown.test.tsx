// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from './Dropdown'

const options = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry' },
]

afterEach(cleanup)

describe('Dropdown', () => {
  it('opens a listbox from the button with ArrowDown and exposes aria state', () => {
    render(<Dropdown label="fruit" value="b" options={options} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: 'fruit' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox', { name: 'fruit' })
    expect(screen.getByRole('option', { name: /Banana/ }).getAttribute('aria-selected')).toBe('true')
    expect(list.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /Banana/ }).id)
  })

  it('moves with arrows, picks with Enter and returns focus to the button', () => {
    const onChange = vi.fn()
    render(<Dropdown label="fruit" value="a" options={options} onChange={onChange} />)
    const btn = screen.getByRole('button', { name: 'fruit' })
    fireEvent.click(btn)
    const list = screen.getByRole('listbox')
    expect(document.activeElement).toBe(list)
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('closes on Escape without changing the value and without bubbling', () => {
    const onChange = vi.fn()
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <Dropdown label="fruit" value="a" options={options} onChange={onChange} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'fruit' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()
  })

  it('jumps to an option by its first letter', () => {
    const onChange = vi.fn()
    render(<Dropdown label="fruit" value="a" options={options} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'fruit' }))
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'c' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
  })
})
