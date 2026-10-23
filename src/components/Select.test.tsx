// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Select } from './Select'

const options: ['a' | 'b', string][] = [['a', 'Apple'], ['b', 'Banana']]

afterEach(cleanup)

describe('Select', () => {
  it('stays open when an unrelated element (e.g. the carousel) scrolls, but closes when the page scrolls', () => {
    render(
      <div>
        <div data-testid="carousel" />
        <Select label="fruit" value="a" options={options} onChange={() => {}} />
      </div>,
    )
    const btn = screen.getByRole('button', { name: /^fruit/ })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.scroll(screen.getByTestId('carousel'))
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.scroll(document)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })
})
