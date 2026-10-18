import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkText, QuotaError, translateText } from './translate'

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

  const warning = 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.'
  const google = (text: string) => ({ ok: true, json: async () => [[[text, 'src', null, null, 1]], null, 'en'] }) as Response
  const byHost = (myMemory: Response, other: Response) =>
    vi.fn((url: string) => Promise.resolve(String(url).includes('mymemory') ? myMemory : other))

  it('reports a QuotaError when MyMemory is out of quota and the fallback fails too', async () => {
    vi.stubGlobal('fetch', byHost(reply(warning), { ok: false, status: 503 } as Response))
    await expect(translateText('quota one', 'en', 'he')).rejects.toBeInstanceOf(QuotaError)
    await expect(translateText('quota two', 'en', 'he')).rejects.toBeInstanceOf(QuotaError)
  })

  it('falls back to Google when MyMemory fails, and joins its segments', async () => {
    const segments = { ok: true, json: async () => [[['שלום ', 'hello '], ['עולם', 'world']], null, 'en'] } as Response
    const fetchMock = byHost({ ok: false, status: 500 } as Response, segments)
    vi.stubGlobal('fetch', fetchMock)
    expect(await translateText('hello world', 'en', 'he')).toBe('שלום עולם')
    const url = new URL(String(fetchMock.mock.calls[1]![0]))
    expect(url.host).toBe('translate.googleapis.com')
    expect(url.searchParams.get('sl')).toBe('en')
    expect(url.searchParams.get('tl')).toBe('he')
  })

  it('skips MyMemory for later passages once its quota has been hit', async () => {
    const fetchMock = byHost(reply(warning), google('תרגום'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await translateText('first passage', '', 'he')).toBe('תרגום')
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get('sl')).toBe('auto')
    fetchMock.mockClear()
    expect(await translateText('second passage', '', 'he')).toBe('תרגום')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to Lingva, trying the next instance, when MyMemory and Google both fail', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('thedaviddelta')) return Promise.resolve({ ok: true, json: async () => ({ translation: 'שלום' }) } as Response)
      return Promise.resolve({ ok: false, status: 503 } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await translateText('lingva only', 'en', 'he')).toBe('שלום')
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/v1/en/he/lingva%20only')
  })
})
