// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { BookMeta } from '../../lib/db'
import type { PendingName } from '../../lib/autoIdentify'

vi.mock('./Cover', () => ({ Cover: () => null }))
const { IdentifyDialog } = await import('./IdentifyDialog')

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
})
afterEach(cleanup)

const books = [{ id: 'a', title: 'ספר א', author: '' }] as BookMeta[]
const waiting: PendingName[] = [{ id: 'a', title: 'שם שגוי', author: 'מחבר שגוי', was: 'ספר א', source: 'name', conflicts: ['cover'] }]

it('lets the user correct a waiting name in place, and saves the corrected name ticked', () => {
  const onSave = vi.fn()
  render(<IdentifyDialog books={books} online={false} waiting={waiting} onSave={onSave} onCancel={() => {}} />)
  // a name a clue speaks against is offered unticked
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByText('תקן'))
  fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'השם הנכון' } })
  fireEvent.change(screen.getByLabelText('מחבר'), { target: { value: 'המחבר הנכון' } })
  fireEvent.click(screen.getByText('סיום'))
  // the correction itself ticks the row
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByText('שמור ספר אחד'))
  expect(onSave).toHaveBeenCalledWith([{ id: 'a', title: 'השם הנכון', author: 'המחבר הנכון' }], [])
})
