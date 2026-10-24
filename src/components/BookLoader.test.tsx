// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BookLoader } from './BookLoader'

afterEach(cleanup)

describe('BookLoader', () => {
  it('shows the book with three turning leaves and the label', () => {
    const { container } = render(<BookLoader label="טוען…" />)
    expect(container.querySelectorAll('.bl-leaf')).toHaveLength(3)
    expect(screen.getByText('טוען…')).toBeTruthy()
  })

  it('has no visible text without a label, and the drawing is hidden from screen readers', () => {
    const { container } = render(<BookLoader inline size="3rem" />)
    expect(container.querySelector('.bl-label')).toBeNull()
    expect(container.querySelector('.bl-icon')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.book-loader.compact')).not.toBeNull()
  })

  it('gives every instance its own gradient ids', () => {
    const { container } = render(<><BookLoader /><BookLoader /></>)
    const ids = [...container.querySelectorAll('linearGradient, radialGradient')].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
