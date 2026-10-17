// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Dialog } from './Dialog'
import { DuplicateBatchDialog } from './library/Dialogs'

// jsdom has no layout, so every element reports offsetParent === null and Dialog would see nothing focusable
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
})
afterEach(cleanup)

describe('Dialog', () => {
  it('takes focus on open, keeps Tab inside and hands focus back to the opener', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(
      <Dialog role="dialog" aria-label="d">
        <button>one</button>
        <button>two</button>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(document.activeElement).toBe(dialog)

    const [one, two] = within(dialog).getAllByRole('button') as [HTMLElement, HTMLElement]
    two.focus()
    fireEvent.keyDown(two, { key: 'Tab' })
    expect(document.activeElement).toBe(one)
    fireEvent.keyDown(one, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(two)

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('DuplicateBatchDialog', () => {
  it('is announced as a modal alertdialog with a name', () => {
    render(<DuplicateBatchDialog batch={{ items: [] } as never} detail={false} onDetail={() => {}} onChange={() => {}} />)
    const d = screen.getByRole('alertdialog', { name: 'ספרים כפולים' })
    expect(d.getAttribute('aria-modal')).toBe('true')
  })
})
