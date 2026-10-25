// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictPanel } from './DictPanel'
import { downloadPack, removePack } from '../../lib/offlineDict'
import { PACK_VERSION } from '../../lib/dictPackFormat'

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  await removePack('en')
})

const install = async () => {
  const file = [{ v: PACK_VERSION, lang: 'en', shards: 1, words: 1, built: 'x' }, { e: { dog: [['noun', 'a domesticated canine']] }, f: {} }].map((l) => JSON.stringify(l) + '\n').join('')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(gzipSync(file)))))
  await downloadPack('en', 0, () => {})
}

describe('DictPanel', () => {
  it('lists the meanings of a word written the same way, opens the one picked, and goes back to the list', async () => {
    const entries = {
      ספר: [
        { p: 'שם עצם', g: ['קובץ דפים מאוגד'], h: 'סֵפֶר', r: { s: ['כרך'] } },
        { p: 'שם עצם', g: ['מי שמספר שיער'], h: 'סַפָּר', r: { s: ['גלב'] } },
      ],
      כרך: [{ p: 'שם עצם', g: ['ספר אחד מסדרה'] }],
    }
    const file = [{ v: PACK_VERSION, lang: 'he', shards: 1, words: 2, built: 'x' }, { e: entries, f: {} }].map((l) => JSON.stringify(l) + '\n').join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(gzipSync(file)))))
    await downloadPack('he', 0, () => {})
    const onFound = vi.fn()
    render(<DictPanel word="ספר" lang="he" offline onFound={onFound} onClose={() => {}} />)
    expect(await screen.findByText('למילה כמה משמעויות. בחרו את המתאימה:')).toBeTruthy()
    expect(screen.getByText('סֵפֶר')).toBeTruthy()
    expect(screen.getByText('סַפָּר')).toBeTruthy()
    // nothing is kept for review until a meaning is picked
    expect(onFound).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('סַפָּר'))
    expect(await screen.findByText(/מי שמספר שיער/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'גלב' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'כרך' })).toBeNull()
    expect(onFound).toHaveBeenLastCalledWith('שם עצם\n1. מי שמספר שיער', 'ספר')
    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }))
    fireEvent.click(await screen.findByText('סֵפֶר'))
    fireEvent.click(await screen.findByRole('button', { name: 'כרך' }))
    expect(await screen.findByText(/ספר אחד מסדרה/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }))
    expect(await screen.findByText('למילה כמה משמעויות. בחרו את המתאימה:')).toBeTruthy()
    await removePack('he')
  })

  it('shows related words, opens one on tap and goes back', async () => {
    const shard = { e: { big: [['adj', 'large']], large: [['adj', 'of great size']], small: [['adj', 'little']] }, f: {}, r: { big: { s: ['large'], a: ['small'] } } }
    const file = [{ v: PACK_VERSION, lang: 'en', shards: 1, words: 3, built: 'x' }, shard].map((l) => JSON.stringify(l) + '\n').join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(gzipSync(file)))))
    await downloadPack('en', 0, () => {})
    const onFound = vi.fn()
    render(<DictPanel word="big" lang="en" offline onFound={onFound} onClose={() => {}} />)
    expect(await screen.findByText('מילים נרדפות:')).toBeTruthy()
    expect(screen.getByText('ניגודים:')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'large' }))
    expect(await screen.findByText(/of great size/)).toBeTruthy()
    expect(onFound).toHaveBeenLastCalledWith('adj\n1. of great size', 'large')
    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }))
    expect(await screen.findByRole('heading', { name: 'big' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'חזרה' })).toBeNull()
  })

  it('answers from the dictionary on the device without asking permission or using the network', async () => {
    await install()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onFound = vi.fn()
    render(<DictPanel word="dog" lang="en" offline onFound={onFound} onClose={() => {}} />)
    expect(await screen.findByText(/a domesticated canine/)).toBeTruthy()
    expect(onFound).toHaveBeenCalledWith('noun\n1. a domesticated canine', 'dog')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says why the device did not answer: no pack for the language', async () => {
    localStorage.setItem('reader:consent:dict', '1')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { pages: [{ extract: 'online entry' }] } }) }))
    render(<DictPanel word="dog" lang="en" offline onFound={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('online entry')).toBeTruthy()
    expect(screen.getByText(/המילון ב-?English לא הורד למכשיר/)).toBeTruthy()
  })

  it('asks permission before going online for a word the device does not have', async () => {
    await install()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<DictPanel word="cat" lang="en" offline onFound={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('לשלוח טקסט לשרת חיצוני?')).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('goes straight to the online dictionary when the offline one is not in use', async () => {
    localStorage.setItem('reader:consent:dict', '1')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { pages: [{ extract: 'online entry' }] } }) }))
    render(<DictPanel word="dog" lang="en" offline={false} onFound={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('online entry')).toBeTruthy()
  })
})
