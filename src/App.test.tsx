// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteBook, getBookMeta, saveBook, type BookRecord } from './lib/db'
import App from './App'

const makeBook = vi.hoisted(() => vi.fn())
vi.mock('foliate-js/view.js', () => ({ makeBook }))
// the readers themselves are not under test, only which one App picks
vi.mock('./components/Library', () => ({ default: () => <p>library</p> }))
vi.mock('./components/Reader', () => ({ default: () => <p>reader</p> }))
vi.mock('./components/InteractiveReader', () => ({ default: () => <p>interactive</p> }))

const book = (extra: Partial<BookRecord> = {}): BookRecord => ({
  id: 'b1',
  title: 'Dune',
  author: 'Herbert',
  kind: 'epub',
  file: new Blob(['x']),
  fileName: 'dune.epub',
  addedAt: 1,
  ...extra,
})

const openBook = () => sessionStorage.setItem('reader:open', 'b1')

beforeEach(() => {
  makeBook.mockReset()
  openBook()
})

afterEach(async () => {
  cleanup()
  sessionStorage.clear()
  await deleteBook('b1')
})

describe('opening a book', () => {
  it('shows a loading message until it knows which reader to use', async () => {
    await saveBook(book({ scripted: false }))
    render(<App />)
    expect(screen.getByRole('status').textContent).toBe('טוען…')
    await screen.findByText('reader')
  })

  it('uses the flag stored on import instead of opening the file', async () => {
    await saveBook(book({ scripted: true }))
    render(<App />)
    await screen.findByText('interactive')
    expect(makeBook).not.toHaveBeenCalled()
  })

  it('checks a book from before the flag once and stores the answer', async () => {
    makeBook.mockResolvedValue({ resources: { manifest: [{ mediaType: 'application/javascript' }] } })
    await saveBook(book())
    render(<App />)
    await screen.findByText('interactive')
    expect(makeBook).toHaveBeenCalledTimes(1)
    expect((await getBookMeta('b1'))?.scripted).toBe(true)
  })

  it('never treats a book converted from a PDF as interactive', async () => {
    await saveBook(book({ fromPdf: true, scripted: true }))
    render(<App />)
    await screen.findByText('reader')
    expect(makeBook).not.toHaveBeenCalled()
  })
})
