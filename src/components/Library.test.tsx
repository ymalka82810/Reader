// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listBooks, saveBook, saveNotes, deleteBook, type BookRecord } from '../lib/db'
import Library from './Library'

const book = (id: string, title: string, author: string, over: Partial<BookRecord> = {}): BookRecord => ({
  id,
  title,
  author,
  kind: 'epub',
  file: new Blob(['x']),
  fileName: `${id}.epub`,
  addedAt: Number(id.replace(/\D/g, '')) || 1,
  folder: '', // loose on the shelf, so the cards show without opening a folder
  ...over,
})

async function resetLibrary() {
  for (const b of await listBooks()) await deleteBook(b.id)
}

beforeEach(async () => {
  localStorage.clear()
  await resetLibrary()
})
afterEach(cleanup)

/** a title appears twice on a card (the cover's fallback and the caption), so these pick one */
const shows = async (title: string) => (await screen.findAllByText(title))[0]!
const count = (title: string) => screen.queryAllByText(title).length

const search = (text: string) =>
  fireEvent.change(screen.getByLabelText('חיפוש בספרייה'), { target: { value: text } })

describe('Library', () => {
  it('invites the reader to add a first book when the library is empty', async () => {
    render(<Library onOpen={() => {}} />)
    expect(await screen.findByText('אין עדיין ספרים.')).toBeTruthy()
    expect(screen.queryByLabelText('חיפוש בספרייה')).toBeNull()
  })

  it('lists the books and opens one on tap', async () => {
    await saveBook(book('b1', 'Dune', 'Herbert'))
    await saveBook(book('b2', 'Emma', 'Austen'))
    const onOpen = vi.fn()
    render(<Library onOpen={onOpen} />)
    fireEvent.click(await shows('Dune'))
    expect(onOpen).toHaveBeenCalledWith('b1')
    expect(await shows('Emma')).toBeTruthy()
  })

  it('search narrows the list by title and author and says when nothing matches', async () => {
    await saveBook(book('b1', 'Dune', 'Herbert'))
    await saveBook(book('b2', 'Emma', 'Austen'))
    render(<Library onOpen={() => {}} />)
    await shows('Dune')

    search('aust')
    await waitFor(() => expect(count('Dune')).toBe(0))
    expect(await shows('Emma')).toBeTruthy()

    search('zzz')
    expect(await screen.findByText('לא נמצאו ספרים עבור ״zzz״.')).toBeTruthy()
  })

  it('search also finds a book through the text of its notes', async () => {
    await saveBook(book('b1', 'Dune', 'Herbert'))
    await saveBook(book('b2', 'Emma', 'Austen'))
    await saveNotes('b1', [
      { id: 'n1', kind: 'highlight', cfi: 'epubcfi(/6/2)', color: '#ff0', text: 'the spice must flow', createdAt: 1 },
    ])
    render(<Library onOpen={() => {}} />)
    await shows('Dune')

    search('spice')
    // the hit is listed under the notes heading, with the matching word picked out
    expect(await screen.findByText('בהערות ובהדגשות')).toBeTruthy()
    expect((await screen.findByText('spice')).tagName).toBe('MARK')
    expect(count('Emma')).toBe(0)
  })

  it('shows the book last read, still in progress, as a way back in', async () => {
    await saveBook(book('b1', 'Dune', 'Herbert', { fraction: 0.4, lastOpened: 50 }))
    await saveBook(book('b2', 'Emma', 'Austen'))
    const onOpen = vi.fn()
    render(<Library onOpen={onOpen} />)
    fireEvent.click(await screen.findByText('המשך לקרוא'))
    expect(onOpen).toHaveBeenCalledWith('b1')
  })

  it('deleting a book can be undone', async () => {
    await saveBook(book('b1', 'Dune', 'Herbert'))
    await saveBook(book('b2', 'Emma', 'Austen'))
    render(<Library onOpen={() => {}} />)
    const card = (await shows('Dune')).closest('li')!
    fireEvent.click(within(card).getByLabelText('פעולות לספר'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'מחק' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'מחק' }))
    await waitFor(() => expect(count('Dune')).toBe(0))
    expect(count('Emma')).toBeGreaterThan(0)

    fireEvent.click(await screen.findByText('בטל'))
    await shows('Dune')
    expect((await listBooks()).length).toBe(2)
  })
})

