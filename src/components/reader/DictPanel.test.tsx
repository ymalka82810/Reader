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
