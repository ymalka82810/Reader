// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteBook, getAllProgress, getNotes, listBooks, saveBook, saveNotes, type BookRecord } from '../lib/db'
import { timeLoc } from '../lib/audioBook'
import AudioPlayer from './AudioPlayer'

const chapters = [
  { title: 'One', start: 0 },
  { title: 'Two', start: 100 },
  { title: 'Three', start: 200 },
]

const audioBook = (over: Partial<BookRecord> = {}): BookRecord => ({
  id: 'a1',
  title: 'Story',
  author: 'Teller',
  kind: 'audio',
  file: new Blob(['x']),
  fileName: 'a1.mp3',
  addedAt: 1,
  folder: '',
  audio: { duration: 300, chapters },
  ...over,
})

const DURATION = 300
const play = vi.fn(() => Promise.resolve())
const pause = vi.fn()
let paused = true

beforeEach(async () => {
  localStorage.clear()
  for (const b of await listBooks()) await deleteBook(b.id)
  paused = true
  play.mockClear()
  pause.mockClear()
  // jsdom has no media pipeline: stand in for the parts the player drives
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => DURATION })
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => paused })
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    paused = false
    this.dispatchEvent(new Event('play'))
    return play()
  }
  HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
    paused = true
    this.dispatchEvent(new Event('pause'))
    pause()
  }
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const audioEl = () => document.querySelector('audio')!
const open = async (book = audioBook()) => {
  await saveBook(book)
  const onClose = vi.fn()
  render(<AudioPlayer id={book.id} onClose={onClose} />)
  await screen.findByLabelText('נגן')
  await waitFor(() => expect(audioEl()).toBeTruthy())
  const el = audioEl()
  fireEvent.loadedMetadata(el)
  return { el, onClose }
}
const at = (el: HTMLAudioElement, secs: number) => {
  el.currentTime = secs
  fireEvent.timeUpdate(el)
}

describe('AudioPlayer', () => {
  it('shows the title and author once the book loads', async () => {
    await open()
    expect(screen.getByRole('heading', { name: 'Story' })).toBeTruthy()
    expect(screen.getByText('Teller')).toBeTruthy()
  })

  it('says so when the book cannot be opened, and can go back', async () => {
    const onClose = vi.fn()
    render(<AudioPlayer id="missing" onClose={onClose} />)
    expect(await screen.findByText('לא הצלחנו לפתוח את הספר הקולי.')).toBeTruthy()
    fireEvent.click(screen.getByText('חזרה לספרייה'))
    expect(onClose).toHaveBeenCalled()
  })

  it('resumes a few seconds before the saved position', async () => {
    const { el } = await open(audioBook({ cfi: timeLoc(120) }))
    expect(el.currentTime).toBe(117)
  })

  it('toggles playback with the big button and reflects the state', async () => {
    await open()
    fireEvent.click(screen.getByLabelText('נגן'))
    expect(play).toHaveBeenCalled()
    fireEvent.click(await screen.findByLabelText('השהה'))
    expect(pause).toHaveBeenCalled()
    expect(await screen.findByLabelText('נגן')).toBeTruthy()
  })

  it('skips back 15 and forward 30 seconds, never past the ends', async () => {
    const { el } = await open()
    at(el, 50)
    fireEvent.click(screen.getByLabelText('קדימה 30 שניות'))
    expect(el.currentTime).toBe(80)
    fireEvent.click(screen.getByLabelText('אחורה 15 שניות'))
    expect(el.currentTime).toBe(65)
    at(el, 5)
    fireEvent.click(screen.getByLabelText('אחורה 15 שניות'))
    expect(el.currentTime).toBe(0)
    at(el, 290)
    fireEvent.click(screen.getByLabelText('קדימה 30 שניות'))
    expect(el.currentTime).toBe(DURATION)
  })

  it('"previous chapter" first returns to the start of the current one, then goes back', async () => {
    const { el } = await open()
    at(el, 150)
    fireEvent.click(screen.getByLabelText('פרק קודם'))
    expect(el.currentTime).toBe(100)
    fireEvent.click(screen.getByLabelText('פרק קודם'))
    expect(el.currentTime).toBe(0)
    fireEvent.click(screen.getByLabelText('פרק הבא'))
    expect(el.currentTime).toBe(100)
  })

  it('lists the chapters and jumps to the chosen one', async () => {
    const { el } = await open()
    fireEvent.click(screen.getByLabelText('פרקים'))
    fireEvent.click(await screen.findByText('Three'))
    expect(el.currentTime).toBe(200)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'פרקים' })).toBeNull())
  })

  it('adds a bookmark with the time and chapter, saves it, and deletes it again', async () => {
    const { el } = await open()
    at(el, 130)
    fireEvent.click(screen.getByText('סימנייה כאן', { exact: false }))
    await waitFor(async () => expect(await getNotes('a1')).toHaveLength(1))
    expect((await getNotes('a1'))[0]).toMatchObject({ kind: 'bookmark', cfi: timeLoc(130), text: '2:10 · Two' })

    fireEvent.click(screen.getByLabelText('סימניות'))
    fireEvent.click(await screen.findByLabelText('מחק'))
    await waitFor(async () => expect(await getNotes('a1')).toHaveLength(0))
    expect(await screen.findByText(/אין עדיין/)).toBeTruthy()
  })

  it('jumps to a bookmark from the list', async () => {
    await saveBook(audioBook())
    await saveNotes('a1', [{ id: 'm1', kind: 'bookmark', cfi: timeLoc(42), color: '#ff0', text: 'Mine', createdAt: 1 }])
    render(<AudioPlayer id="a1" onClose={() => {}} />)
    await screen.findByLabelText('נגן')
    await waitFor(() => expect(audioEl()).toBeTruthy())
    fireEvent.loadedMetadata(audioEl())
    fireEvent.click(screen.getByLabelText('סימניות'))
    fireEvent.click(await screen.findByText('Mine'))
    expect(audioEl().currentTime).toBe(42)
  })

  it('changes the speed, clamps it and remembers it', async () => {
    const { el } = await open()
    fireEvent.click(screen.getByLabelText('מהירות'))
    fireEvent.click(await screen.findByText('2×'))
    expect(el.playbackRate).toBe(2)
    expect(localStorage.getItem('reader:audioSpeed')).toBe('2')
    for (let i = 0; i < 30; i++) fireEvent.click(screen.getByLabelText('האץ'))
    expect(el.playbackRate).toBe(3)
    expect((screen.getByLabelText('האץ') as HTMLButtonElement).disabled).toBe(true)
  })

  it('starts at the remembered speed', async () => {
    localStorage.setItem('reader:audioSpeed', '1.5')
    const { el } = await open()
    expect(el.playbackRate).toBe(1.5)
  })

  it('the minutes sleep timer pauses playback when it runs out', async () => {
    await open()
    fireEvent.click(screen.getByLabelText('נגן'))
    fireEvent.click(screen.getByLabelText('טיימר שינה'))
    const fifteen = await screen.findByText('15 ד׳')
    vi.useFakeTimers()
    fireEvent.click(fifteen)
    pause.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(15 * 60_000 + 10)
    })
    expect(pause).toHaveBeenCalled()
    expect(screen.getByText('נעצר לפי טיימר השינה')).toBeTruthy()
  })

  it('the end-of-chapter sleep timer pauses as the next chapter begins', async () => {
    const { el } = await open()
    fireEvent.click(screen.getByLabelText('נגן'))
    fireEvent.click(screen.getByLabelText('טיימר שינה'))
    fireEvent.click(await screen.findByText('סוף הפרק'))
    pause.mockClear()
    at(el, 50)
    expect(pause).not.toHaveBeenCalled()
    at(el, 99.8)
    expect(pause).toHaveBeenCalled()
    expect(await screen.findByText('נעצר בסוף הפרק')).toBeTruthy()
  })

  it('saves the position when paused and when the player closes', async () => {
    const { el } = await open()
    at(el, 77)
    fireEvent.pause(el)
    await waitFor(async () => expect((await getAllProgress())['a1']?.cfi).toBe(timeLoc(77)))
    expect((await getAllProgress())['a1']?.fraction).toBeCloseTo(77 / DURATION)

    at(el, 120)
    fireEvent.click(screen.getByLabelText('חזרה לספרייה'))
    await waitFor(async () => expect((await getAllProgress())['a1']?.cfi).toBe(timeLoc(120)))
  })

  it('Escape closes an open panel first, then the player; Space toggles playback', async () => {
    const { onClose } = await open()
    const root = document.querySelector('.reader.audio')!
    fireEvent.click(screen.getByLabelText('מהירות'))
    await screen.findByText('2×')
    fireEvent.keyDown(root, { key: 'Escape' })
    expect(screen.queryByText('2×')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(root, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    fireEvent.keyDown(root, { key: ' ' })
    expect(play).toHaveBeenCalled()
  })

  it('shows the error state when the audio fails to load', async () => {
    const { el } = await open()
    fireEvent.error(el)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
