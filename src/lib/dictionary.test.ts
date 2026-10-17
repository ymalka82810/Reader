import { afterEach, describe, expect, it, vi } from 'vitest'
import { firstWord, lookUpWord } from './dictionary'

const reply = (pages: object[]) => ({ ok: true, json: async () => ({ query: { pages } }) }) as Response

afterEach(() => vi.unstubAllGlobals())

describe('firstWord', () => {
  it('takes the first word and drops surrounding punctuation', () => {
    expect(firstWord('  "שלום, עולם" ')).toBe('שלום')
    expect(firstWord('(hello) world')).toBe('hello')
    expect(firstWord('...')).toBe('')
  })
})

describe('lookUpWord', () => {
  it('returns the extract and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply([{ extract: 'a greeting' }]))
    vi.stubGlobal('fetch', fetchMock)
    expect(await lookUpWord('en', 'hello')).toBe('a greeting')
    expect(await lookUpWord('en', 'hello')).toBe('a greeting')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('https://en.wiktionary.org/w/api.php')
  })

  it('returns null for a missing entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply([{ missing: true }])))
    expect(await lookUpWord('en', 'zzzqx')).toBeNull()
  })

  it('rejects, and does not cache, when the service fails', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(reply([{ extract: 'ok' }]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(lookUpWord('en', 'retry')).rejects.toThrow()
    expect(await lookUpWord('en', 'retry')).toBe('ok')
  })
})
