import { describe, expect, it } from 'vitest'
import { addKaikkiLine, normalizeWord, shardOf, type PackEntry } from './dictPackFormat'

describe('normalizeWord', () => {
  it('drops niqqud and Arabic vowel signs, and leaves other languages alone', () => {
    expect(normalizeWord('he', 'כֶּלֶב')).toBe('כלב')
    expect(normalizeWord('ar', 'كِتَاب')).toBe('كتاب')
    expect(normalizeWord('fr', 'café')).toBe('café')
    expect(normalizeWord('fr', 'café')).toBe('café')
  })
})

describe('shardOf', () => {
  it('is stable and stays within the shards', () => {
    expect(shardOf('dog', 7)).toBe(shardOf('dog', 7))
    for (const w of ['a', 'כלב', 'ünïcode', 'x'.repeat(50)]) expect(shardOf(w, 13)).toBeLessThan(13)
    expect(shardOf('anything', 1)).toBe(0)
  })
  it('matches the value the packs were built with', () => {
    // a pack built with another hash would miss every word, so this must never change without bumping PACK_VERSION
    expect(shardOf('dog', 100)).toBe(17)
    expect(shardOf('כלב', 1000)).toBe(185)
    expect(shardOf('', 10)).toBe(0x811c9dc5 % 10)
  })
})

describe('addKaikkiLine', () => {
  const run = (lines: Parameters<typeof addKaikkiLine>[1][]) => {
    const entries = new Map<string, PackEntry[]>()
    const forms = new Map<string, string>()
    for (const l of lines) addKaikkiLine('en', l, entries, forms)
    return { entries, forms }
  }

  it('keeps the part of speech and the first definitions', () => {
    const { entries } = run([{ word: 'dog', pos: 'noun', senses: [{ glosses: ['a domesticated canine'] }, { glosses: ['a man'] }, { glosses: ['a mean person'] }, { glosses: ['a fourth one'] }] }])
    expect(entries.get('dog')).toEqual([['noun', 'a domesticated canine', 'a man', 'a mean person']])
  })

  it('uses the most specific gloss of a sub-sense', () => {
    const { entries } = run([{ word: 'run', pos: 'verb', senses: [{ glosses: ['to move', 'to move quickly on foot'] }] }])
    expect(entries.get('run')).toEqual([['verb', 'to move quickly on foot']])
  })

  it('turns an inflected form into a pointer to its base word', () => {
    const { entries, forms } = run([{ word: 'dogs', pos: 'noun', senses: [{ glosses: ['plural of dog'], form_of: [{ word: 'dog' }] }] }])
    expect(entries.size).toBe(0)
    expect(forms.get('dogs')).toBe('dog')
  })

  it('merges the entries of a word with several parts of speech, and skips lines with nothing to show', () => {
    const { entries } = run([
      { word: 'left', pos: 'adj', senses: [{ glosses: ['opposite of right'] }] },
      { word: 'left', pos: 'verb', senses: [{ glosses: ['past of leave'] }] },
      { word: 'blank', pos: 'noun', senses: [{}] },
      { pos: 'noun', senses: [{ glosses: ['no word'] }] },
    ])
    expect(entries.get('left')).toHaveLength(2)
    expect(entries.has('blank')).toBe(false)
  })
})

describe('addKaikkiLine forms table', () => {
  it('points every inflected form in the table of a word at that word', () => {
    const entries = new Map<string, PackEntry[]>()
    const forms = new Map<string, string>()
    addKaikkiLine(
      'he',
      {
        word: 'כתב',
        pos: 'verb',
        senses: [{ glosses: ['to write'] }],
        forms: [
          { form: 'כָּתַב', tags: ['canonical'] },
          { form: 'katáv', tags: ['romanization'] },
          { form: 'כָּתַבְתִּי', tags: ['past', 'first-person'] },
          { form: 'יִכְתְּבוּ', tags: ['future'] },
          { form: 'אני כתבתי' },
          { form: 'כֹּתֵב' },
        ],
      },
      entries,
      forms,
    )
    expect(forms.get('כתבתי')).toBe('כתב')
    expect(forms.get('יכתבו')).toBe('כתב')
    expect(forms.has('katáv')).toBe(false)
    expect(forms.has('כתב')).toBe(false)
    expect(forms.size).toBe(2)
  })

  it('keeps the pointer of a form that already has its own line', () => {
    const entries = new Map<string, PackEntry[]>()
    const forms = new Map<string, string>([['dogs', 'dog']])
    addKaikkiLine('en', { word: 'dogs', pos: 'verb', senses: [{ glosses: ['to follow'] }], forms: [{ form: 'dogged' }] }, entries, forms)
    expect(forms.get('dogs')).toBe('dog')
    expect(forms.get('dogged')).toBe('dogs')
  })
})

describe('addKaikkiLine related words', () => {
  it('collects synonyms, antonyms, related and derived words of the line and its senses', () => {
    const entries = new Map<string, PackEntry[]>()
    const forms = new Map<string, string>()
    const relations = new Map<string, import('./dictPackFormat').Relations>()
    addKaikkiLine(
      'he',
      {
        word: 'גדול',
        pos: 'adj',
        synonyms: [{ word: 'עָנָק' }, { word: 'Thesaurus:גדול' }],
        senses: [{ glosses: ['big'], synonyms: [{ word: 'ענק' }, { word: 'רב' }], antonyms: [{ word: 'קָטָן' }] }],
        derived: [{ word: 'גודל' }, { word: 'גדול' }],
      },
      entries,
      forms,
      relations,
    )
    expect(relations.get('גדול')).toEqual({ s: ['ענק', 'רב'], a: ['קטן'], d: ['גודל'] })
  })

  it('records nothing for a line without definitions', () => {
    const relations = new Map<string, import('./dictPackFormat').Relations>()
    addKaikkiLine('en', { word: 'dogs', pos: 'noun', senses: [{ form_of: [{ word: 'dog' }], synonyms: [{ word: 'hounds' }] }] }, new Map(), new Map(), relations)
    expect(relations.size).toBe(0)
  })
})
