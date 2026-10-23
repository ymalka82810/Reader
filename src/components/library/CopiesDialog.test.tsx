// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { BookMeta } from '../../lib/db'

const mergeCopies = vi.fn(async (_g: BookMeta[][]) => _g.length)
const markNotCopies = vi.fn((_g: BookMeta[][]) => {})
vi.mock('../../lib/bookCopies', () => ({
  keeperOf: async (g: BookMeta[]) => g[0],
  mergeCopies: (g: BookMeta[][]) => mergeCopies(g),
  markNotCopies: (g: BookMeta[][]) => markNotCopies(g),
}))
const { CopiesDialog } = await import('./CopiesDialog')

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const book = (id: string, title: string, kind: 'epub' | 'pdf') => ({ id, title, author: 'ריק ריירדן', kind }) as BookMeta
const groups = [
  [book('a', 'גנב הברק', 'epub'), book('b', 'גנב הברק', 'pdf')],
  [book('c', 'ים המפלצות', 'epub'), book('d', 'ים המפלצות', 'pdf')],
]

it('shows each group, which copy stays and which goes, and sets apart only the group it was asked about', async () => {
  render(<CopiesDialog groups={groups} confirm={async () => true} onChanged={() => {}} onClose={() => {}} />)
  await waitFor(() => expect(screen.getAllByText('נשאר:')).toHaveLength(2))
  expect(screen.getAllByText('יימחק:')).toHaveLength(2)
  fireEvent.click(screen.getAllByText('אלה ספרים שונים')[1]!)
  await waitFor(() => expect(markNotCopies).toHaveBeenCalledWith([groups[1]]))
  expect(mergeCopies).not.toHaveBeenCalled()
})

it('merges all only after a confirmation', async () => {
  const confirm = vi.fn(async () => false)
  render(<CopiesDialog groups={groups} confirm={confirm} onChanged={() => {}} onClose={() => {}} />)
  await waitFor(() => expect(screen.getAllByText('נשאר:')).toHaveLength(2))
  fireEvent.click(screen.getByText('מיזוג של כולם'))
  await waitFor(() => expect(confirm).toHaveBeenCalled())
  expect(mergeCopies).not.toHaveBeenCalled()
})
