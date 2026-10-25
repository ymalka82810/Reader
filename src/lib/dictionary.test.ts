import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanExtract, firstWord, lookUpWord, lookUpWordOnline } from './dictionary'

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

describe('lookUpWord, words as they stand in the text', () => {
  it('falls back to the likeliest base word that has a page', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const p = new URL(url).searchParams
      if (p.get('prop') === 'extracts') return reply(p.get('titles') === 'ספר' ? [{ title: 'ספר', extract: 'book' }] : [{ missing: true }])
      return reply(p.get('titles')!.split('|').map((title) => (title === 'ספר' ? { title } : { title, missing: true })))
    })
    vi.stubGlobal('fetch', fetchMock)
    const text = await lookUpWord('he', 'והספרים')
    expect(text).toContain('צורה של ״ספר״:')
    expect(text).toContain('book')
  })
})

describe('cleanExtract', () => {
  it('drops etymology, phrases, translations, links and references, and keeps definitions and synonyms', () => {
    const text = [
      '== אֲוִיר ==',
      'תערובת גזים הממלאת את האטמוספירה.',
      '=== גיזרון ===',
      'לשון חז"ל מיוונית.',
      '=== צירופים ===',
      'אוויר חם',
      '=== מילים נרדפות ===',
      'אטמוספירה',
      '=== תרגום ===',
      'air',
      '==== תת סעיף ====',
      'עדיין תרגום',
      '=== קישורים חיצוניים ===',
      '=== אסמכתאות ===',
    ].join('\n')
    expect(cleanExtract(text)).toBe('אֲוִיר\nתערובת גזים הממלאת את האטמוספירה.\n\nמילים נרדפות\nאטמוספירה')
  })

  it('works the same on other editions', () => {
    expect(cleanExtract('== English ==\n=== Etymology ===\nFrom Latin.\n=== Noun ===\nair\n# a gas')).toBe('English\n\nNoun\nair\n# a gas')
  })
})

describe('lookUpWordOnline', () => {
  it('reads Hebrew meanings from the wikitext of the page of the base word', async () => {
    const wikitext = '==אֲוִיר==\n{{ניתוח דקדוקי\n|כתיב מלא=אוויר\n|חלק דיבר=שם עצם\n}}\n# תערובת גזים.\n#:* דוגמה\n===מילים נרדפות===\n* [[אטמוספירה]]\n===גיזרון===\n* מיוונית\n'
    const fetchMock = vi.fn(async (url: string) => {
      const p = new URL(url).searchParams
      if (p.get('prop') === 'revisions') return { ok: true, json: async () => ({ query: { pages: [{ title: 'אויר', revisions: [{ slots: { main: { content: wikitext } } }] }] } }) } as Response
      return reply(p.get('titles')!.split('|').map((title) => (title === 'אוויר' ? { title: 'אויר' } : { title, missing: true })))
    })
    vi.stubGlobal('fetch', fetchMock)
    const meanings = await lookUpWordOnline('he', 'האוויר')
    expect(Array.isArray(meanings)).toBe(true)
    const [m] = meanings as Exclude<typeof meanings, string | null>
    expect(m).toMatchObject({ headword: 'אֲוִיר', pos: 'שם עצם', glosses: ['תערובת גזים.'], formOf: true, related: [{ kind: 's', words: ['אטמוספירה'] }] })
  })

  it('gives the text of the entry in other languages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply([{ extract: '== Noun ==\na gas\n=== Translations ===\nאוויר' }])))
    expect(await lookUpWordOnline('en', 'airx')).toBe('Noun\na gas')
  })
})
