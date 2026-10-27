// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FoliateRelocateDetail } from 'foliate-js/view.js'
import type { FoliateHandlers } from '../hooks/useFoliateView'
import { getNotes, mergeProgress } from '../lib/db'
import Reader from './Reader'

// the real hook opens the book in foliate's custom element, which needs a browser; the reader's own logic
// (toolbars, panels, bookmarks, jumping) is what is under test, so the view is replaced by a stub
const stub = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'ready' | 'error',
  error: '',
  handlers: undefined as FoliateHandlers | undefined,
  view: undefined as unknown,
}))

vi.mock('../hooks/useFoliateView', () => ({
  useFoliateView: (_id: string, _host: unknown, viewRef: { current: unknown }, _s: unknown, _face: string, _start: unknown, handlers: FoliateHandlers) => {
    stub.handlers = handlers
    viewRef.current = stub.view
    return {
      status: stub.status,
      error: stub.error,
      title: 'Dune',
      dir: 'ltr' as const,
      toc: [
        { label: 'Chapter 1', href: 'ch1', depth: 0 },
        { label: 'Chapter 2', href: 'ch2', depth: 0 },
      ],
      bookLang: { current: 'en' },
    }
  },
}))

const makeView = () => ({
  goTo: vi.fn(() => Promise.resolve()),
  goToFraction: vi.fn(() => Promise.resolve()),
  addAnnotation: vi.fn(() => Promise.resolve()),
  deleteAnnotation: vi.fn(() => Promise.resolve()),
  clearSearch: vi.fn(),
  renderer: { getContents: () => [], setAttribute() {}, removeAttribute() {}, setStyles() {} },
})
let view: ReturnType<typeof makeView>

const relocate = (d: Partial<FoliateRelocateDetail>) =>
  act(() => {
    stub.handlers!.relocate({ fraction: 0, cfi: 'epubcfi(/6/2)', ...d } as FoliateRelocateDetail)
  })

const open = async (props: Partial<React.ComponentProps<typeof Reader>> = {}) => {
  const onClose = vi.fn()
  const onSettings = vi.fn()
  render(<Reader id="b1" onClose={onClose} onSettings={onSettings} {...props} />)
  await waitFor(() => expect(stub.handlers).toBeTruthy())
  return { onClose, onSettings }
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('reader:tapHelpSeen', '1') // the first-run hint is covered in its own test
  stub.status = 'ready'
  stub.error = ''
  stub.handlers = undefined
  view = makeView()
  stub.view = view
})
afterEach(cleanup)

describe('Reader', () => {
  it('shows the book title in the top bar', async () => {
    await open()
    expect(screen.getByRole('heading', { name: 'Dune' })).toBeTruthy()
    expect(screen.getByRole('region', { name: /Dune/ })).toBeTruthy()
  })

  it('shows a loading message while the book opens', async () => {
    stub.status = 'loading'
    await open()
    expect(screen.getByText('טוען…')).toBeTruthy()
  })

  it('shows the error and offers a way back when the book cannot be opened', async () => {
    stub.status = 'error'
    stub.error = 'broken file'
    const { onClose } = await open()
    expect(screen.getByRole('alert').textContent).toContain('broken file')
    fireEvent.click(screen.getByText('חזרה לספרייה', { selector: 'button' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('the back arrow leaves the book', async () => {
    const { onClose } = await open()
    fireEvent.click(screen.getByLabelText('חזרה לספרייה'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the percent read as the view reports its position, and announces the chapter', async () => {
    await open()
    await relocate({ fraction: 0.42, tocItem: { label: 'Chapter 2', href: 'ch2' } })
    expect(await screen.findByText('42%', { selector: '.label' })).toBeTruthy()
    expect(document.querySelector('.sr-only')!.textContent).toBe('Chapter 2, 42%')
    expect((screen.getByLabelText('מיקום בספר') as HTMLInputElement).value).toBe('0.42')
  })

  it('shows the time left to the end of the chapter and of the book', async () => {
    await open()
    // the default pace is 20 s per KB: 10 foliate units (16 KB) are about 5 minutes
    await relocate({ fraction: 0.5, time: { section: 10, total: 100 }, section: { current: 1, total: 5 } })
    expect(await screen.findByText('5 דק׳ לסוף הפרק · 53 דק׳ לסוף הספר')).toBeTruthy()
  })

  it('a book opened again after a few days shows where the reader stopped', async () => {
    // a book of its own: the other tests save a fresh position for b1
    await mergeProgress('away', { cfi: 'epubcfi(/6/4)', fraction: 0.3, lastOpened: Date.now() - 5 * 24 * 60 * 60 * 1000 })
    await open({ id: 'away' })
    // prepare reads the saved position; give it a moment
    await act(async () => {
      await stub.handlers!.prepare()
    })
    // the book's section is a document of its own
    const doc = document.implementation.createHTMLDocument('')
    const p = doc.createElement('p')
    p.textContent = 'השורה האחרונה שנקראה לפני ההפסקה'
    doc.body.append(p)
    const range = doc.createRange()
    range.setStart(p.firstChild!, p.textContent.length)
    await relocate({ fraction: 0.3, range, tocItem: { label: 'Chapter 2', href: 'ch2' } })
    expect(await screen.findByText('איפה הייתי?', { selector: 'h3' })).toBeTruthy()
    expect(screen.getByText('עברו 5 ימים · Chapter 2')).toBeTruthy()
    expect(screen.getByText('השורה האחרונה שנקראה לפני ההפסקה')).toBeTruthy()
    fireEvent.click(screen.getByText('המשך לקרוא'))
    expect(screen.queryByText('איפה הייתי?', { selector: 'h3' })).toBeNull()
  })

  it('dragging the position slider jumps to that fraction when released', async () => {
    await open()
    await relocate({ fraction: 0.1 })
    const slider = screen.getByLabelText('מיקום בספר')
    fireEvent.change(slider, { target: { value: '0.75' } })
    expect(await screen.findByText('75%', { selector: '.label' })).toBeTruthy()
    expect(view.goToFraction).not.toHaveBeenCalled()
    fireEvent.keyUp(slider)
    expect(view.goToFraction).toHaveBeenCalledWith(0.75)
  })

  it('a jump leaves a "back" chip that returns to where the reader was', async () => {
    await open()
    await relocate({ cfi: 'epubcfi(/6/10)', fraction: 0.2 })
    fireEvent.change(screen.getByLabelText('מיקום בספר'), { target: { value: '0.9' } })
    fireEvent.keyUp(screen.getByLabelText('מיקום בספר'))
    const back = await screen.findByText(/חזרה/, { selector: '.jump-chips button' })
    fireEvent.click(back)
    expect(view.goTo).toHaveBeenCalledWith('epubcfi(/6/10)')
    await waitFor(() => expect(document.querySelector('.jump-chips')).toBeNull())
  })

  it('the bookmark button toggles a bookmark at the current location and saves it', async () => {
    await open()
    await relocate({ cfi: 'epubcfi(/6/4)', fraction: 0.3, tocItem: { label: 'Chapter 1', href: 'ch1' } })
    const btn = screen.getByLabelText('סימנייה')
    expect(btn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(btn)
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'))
    await waitFor(async () => expect(await getNotes('b1')).toHaveLength(1))
    expect((await getNotes('b1'))[0]).toMatchObject({ kind: 'bookmark', cfi: 'epubcfi(/6/4)', text: 'Chapter 1 · 30%' })

    fireEvent.click(btn)
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'))
    await waitFor(async () => expect(await getNotes('b1')).toHaveLength(0))
  })

  it('the contents panel lists the chapters and jumps to the chosen one', async () => {
    await open()
    await relocate({ cfi: 'epubcfi(/6/2)', fraction: 0.05 })
    fireEvent.click(screen.getByLabelText('ניווט בספר'))
    fireEvent.click(await screen.findByText('Chapter 2'))
    expect(view.goTo).toHaveBeenCalledWith('ch2')
    await waitFor(() => expect(screen.queryByText('Chapter 2')).toBeNull())
  })

  it('opens the settings panel from the top bar', async () => {
    await open()
    fireEvent.click(screen.getByLabelText('הגדרות תצוגה'))
    expect(await screen.findByRole('dialog', { name: 'הגדרות תצוגה' })).toBeTruthy()
  })

  it('keeps only what changes while reading in the panel, with a link to all the settings', async () => {
    const { onSettings } = await open()
    fireEvent.click(screen.getByLabelText('הגדרות תצוגה'))
    const panel = await screen.findByRole('dialog', { name: 'הגדרות תצוגה' })
    expect(panel.querySelector('#bright')).toBeTruthy()
    for (const gone of ['#ls', '#cw', '#mg', '.upload', '.a11y-set']) expect(panel.querySelector(gone)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'כל ההגדרות…' }))
    expect(onSettings).toHaveBeenCalled()
  })

  it('distraction-free mode hides the bars and says how to bring them back', async () => {
    await open()
    expect(document.querySelector('.topbar')!.className).not.toContain('hidden')
    fireEvent.click(screen.getByLabelText('מצב ללא הסחות'))
    expect(await screen.findByText(/מצב ללא הסחות — הקשה/)).toBeTruthy()
    expect(document.querySelector('.reader')!.className).toContain('focus')
    expect(document.querySelector('.topbar')!.className).toContain('hidden')
  })

  it('shows the tap hint on the first visit only, and remembers it was dismissed', async () => {
    localStorage.removeItem('reader:tapHelpSeen')
    await open()
    const hint = await screen.findByRole('dialog', { name: 'הסבר על אזורי הלחיצה' })
    fireEvent.click(hint)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'הסבר על אזורי הלחיצה' })).toBeNull())
    expect(localStorage.getItem('reader:tapHelpSeen')).toBe('1')
  })

  it('restores the saved settings and writes changes back', async () => {
    localStorage.setItem('reader:settings', JSON.stringify({ fontSize: 30 }))
    await open()
    // opening the book re-saves the settings it started with, so they survive a reload
    await waitFor(() => expect(JSON.parse(localStorage.getItem('reader:settings') ?? '{}').fontSize).toBe(30))
  })
})
