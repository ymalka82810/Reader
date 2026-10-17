import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkText, translateText } from './translate'

const reply = (translatedText: string, responseStatus: number | string = 200) =>
  ({ ok: true, json: async () => ({ responseStatus, responseData: { translatedText } }) }) as Response

const pairOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  new URL(String(fetchMock.mock.calls[call]![0])).searchParams.get('langpair')

afterEach(() => vi.unstubAllGlobals())

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('  hello world ')).toEqual(['hello world'])
  })

  it('splits at sentence ends and loses no text', () => {
    const chunks = chunkText('First one. Second one is here! Third? Fourth and last.', 25)
    expect(chunks.every((c) => c.length <= 25)).toBe(true)
    expect(chunks.join(' ')).toBe('First one. Second one is here! Third? Fourth and last.')
  })

  it('falls back to spaces, then to a hard cut', () => {
    expect(chunkText('aaa bbb ccc', 5)).toEqual(['aaa', 'bbb', 'ccc'])
    expect(chunkText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  })
})

describe('translateText', () => {
  it('asks for the language pair and caches the answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('שלום'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await translateText('hello', 'en', 'he')).toBe('שלום')
    expect(await translateText('hello', 'en', 'he')).toBe('שלום')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pairOf(fetchMock, 0)).toBe('en|he')
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('q')).toBe('hello')
  })

  it('detects the source when unknown or equal to the target', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('x'))
    vi.stubGlobal('fetch', fetchMock)
    await translateText('one', '', 'he')
    await translateText('two', 'he', 'he')
    expect(pairOf(fetchMock, 0)).toBe('Autodetect|he')
    expect(pairOf(fetchMock, 1)).toBe('Autodetect|he')
  })

  it('rejects, and does not cache, when the service reports an error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('QUOTA', '429')).mockResolvedValue(reply('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(translateText('retry', 'en', 'he')).rejects.toThrow()
    expect(await translateText('retry', 'en', 'he')).toBe('ok')
  })
})
