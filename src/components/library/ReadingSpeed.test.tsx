// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveBook, type BookRecord } from '../../lib/db'
import { learnPace } from '../../lib/pace'
import { addStats } from '../../lib/stats'
import { ReadingSpeed } from './ReadingSpeed'

const book = (id: string, title: string): BookRecord => ({
  id,
  title,
  author: 'A',
  kind: 'epub',
  file: new Blob(['x']),
  fileName: `${id}.epub`,
  addedAt: 1,
  words: 100_000,
})

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('ReadingSpeed', () => {
  it('says the speed comes later while too little was read', () => {
    render(<ReadingSpeed />)
    expect(screen.getByText('מהירות הקריאה שלי')).toBeTruthy()
    expect(screen.getByText(/המהירות תופיע/)).toBeTruthy()
  })

  it('shows the speed now, by language, and the books read faster or slower than usual', async () => {
    learnPace(1200, 6000, 'he') // 300 words a minute
    await saveBook(book('quick', 'ספר מהיר'))
    await saveBook(book('heavy', 'ספר כבד'))
    await addStats('quick', 1200, 0.1) // 500 wpm
    await addStats('heavy', 1200, 0.02) // 100 wpm
    render(<ReadingSpeed />)
    expect(document.querySelector('.goals-stats strong')!.textContent).toBe('300')
    expect(screen.getByText('לפי שפת הספר')).toBeTruthy()
    expect(await screen.findByText('ספר מהיר')).toBeTruthy()
    expect(screen.getByText('ספרים שקראת מהר מהרגיל')).toBeTruthy()
    expect(screen.getByText('ספר כבד')).toBeTruthy()
    expect(screen.getByText('ספרים שקראת לאט מהרגיל')).toBeTruthy()
  })
})
