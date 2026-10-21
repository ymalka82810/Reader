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
  // the one-time identification of the library would ask about Google Books on every first render
  localStorage.setItem('reader:identify:backfill5', 'done')
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


  it('switches between grid and list view and remembers the choice', async () => {
    await saveBook(book('b1', 'Dune', 'Herbert'))
    await saveBook(book('b2', 'Emma', 'Austen'))
    const { container, unmount } = render(<Library onOpen={() => {}} />)
    await shows('Dune')
    expect(container.querySelector('ul.grid.list')).toBeNull()
    fireEvent.click(screen.getByLabelText('תצוגת רשימה'))
    expect(container.querySelector('ul.grid.list')).toBeTruthy()
    unmount()
    const again = render(<Library onOpen={() => {}} />)
    await shows('Dune')
    expect(again.container.querySelector('ul.grid.list')).toBeTruthy()
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

  it('has nothing to identify once for a library that was empty when it first loaded', async () => {
    localStorage.removeItem('reader:identify:backfill5')
    render(<Library onOpen={() => {}} />)
    await waitFor(() => expect(localStorage.getItem('reader:identify:backfill5')).toBe('done'))
    await saveBook(book('b1', 'Dune', 'Herbert'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('identifies the books already in the library once, after asking about Google Books', async () => {
    localStorage.removeItem('reader:identify:backfill5')
    await saveBook(book('b1', 'Dune', 'Herbert'))
    render(<Library onOpen={() => {}} />)
    const ask = await screen.findByRole('alertdialog')
    expect(ask.textContent).toContain('ISBN')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      fireEvent.click(within(ask).getByRole('button', { name: 'אפשר' }))
      await waitFor(() => expect(localStorage.getItem('reader:identify:backfill5')).toBe('done'))
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('googleapis.com/books')
    } finally {
      vi.unstubAllGlobals()
    }
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

  it('edits the name in the series template and fills it from Google Books after consent', async () => {
    await saveBook(book('b1', 'גנב הברק', ''))
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ volumeInfo: { title: "פרסי ג'קסון 1 - גנב הברק", authors: ['ריק ריירדן'] } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<Library onOpen={() => {}} />)
      const card = (await shows('גנב הברק')).closest('li')!
      fireEvent.click(within(card).getByLabelText('פעולות לספר'))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'עריכת פרטים ותגיות' }))
      const dialog = await screen.findByRole('dialog', { name: 'עריכת פרטי ספר' })
      expect((within(dialog).getByLabelText('שם הספר') as HTMLInputElement).value).toBe('גנב הברק')

      fireEvent.click(within(dialog).getByRole('button', { name: 'זיהוי באינטרנט' }))
      // nothing leaves the device before the user agrees
      const ask = await screen.findByRole('alertdialog')
      expect(fetchMock).not.toHaveBeenCalled()
      fireEvent.click(within(ask).getByRole('button', { name: 'אפשר' }))

      await waitFor(() => expect((within(dialog).getByLabelText('סדרה') as HTMLInputElement).value).toBe("פרסי ג'קסון"))
      expect((within(dialog).getByLabelText('מספר בסדרה') as HTMLInputElement).value).toBe('1')
      expect((within(dialog).getByLabelText('מחבר') as HTMLInputElement).value).toBe('ריק ריירדן')
      expect(within(dialog).getByText("השם שיישמר: פרסי ג'קסון 1 - גנב הברק")).toBeTruthy()

      fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }))
      await waitFor(async () => expect((await listBooks())[0]).toMatchObject({ title: "פרסי ג'קסון 1 - גנב הברק", author: 'ריק ריירדן' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
