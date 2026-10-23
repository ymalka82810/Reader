// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  it('answers from the dictionary on the device without asking permission or using the network', async () => {
    await install()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onFound = vi.fn()
    render(<DictPanel word="dog" lang="en" offline onFound={onFound} onClose={() => {}} />)
    expect(await screen.findByText(/a domesticated canine/)).toBeTruthy()
    expect(onFound).toHaveBeenCalledWith('noun\n1. a domesticated canine')
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
