import { describe, expect, it } from 'vitest'
import { crossCheck } from './bookLookup'
import type { EpubMeta } from './bookText'

const meta = (over: Partial<EpubMeta>): EpubMeta => ({ title: '', authors: [], series: '', number: '', identifiers: [], ...over })
const name = { series: '', number: '', title: 'נסיכת האפר', author: 'לאורה סבסטיאן' }

describe('crossCheck', () => {
  it('lets each source agree on the title and the author', () => {
    const v = crossCheck(name, { title: 'נסיכת האפר' }, ['נסיכת האפר', 'לאורה סבסטיאן'], meta({ title: 'נסיכת האפר', authors: ['לאורה סבסטיאן'], cover: { largest: 'נסיכת האפר', lines: ['לאורה סבסטיאן'] } }))
    expect(new Set(v.filter(([, x]) => x === 'agree').map(([c]) => c))).toEqual(new Set(['meta', 'page', 'cover', 'name']))
    expect(v.some(([, x]) => x === 'against')).toBe(false)
  })
  it('has the package speak against another title or another author', () => {
    expect(crossCheck(name, { title: '' }, [], meta({ title: 'ספר אחר לגמרי' }))).toContainEqual(['meta', 'against'])
    expect(crossCheck(name, { title: '' }, [], meta({ authors: ['מישהו אחר'] }))).toContainEqual(['meta', 'against'])
  })
  it('takes one author in two spellings as one, and a package titled by the series as no conflict', () => {
    expect(crossCheck(name, { title: '' }, [], meta({ authors: ['לורה סבסטיאן'] }))).toEqual([['meta', 'agree']])
    const third = { series: 'גורלו של אפולו', number: '3', title: 'המבוך הבוער', author: 'ריק ריירדן' }
    expect(crossCheck(third, { title: '' }, [], meta({ title: 'גורלו של אפולו' }))).toEqual([['meta', 'agree']])
  })
  it('never has the cover, the title page or the file name speak against: what they lack proves nothing', () => {
    const v = crossCheck(name, { title: 'משהו אחר' }, ['שורה אחרת'], meta({ cover: { largest: 'כותר שנקרא לא נכון', lines: [] } }))
    expect(v).toEqual([])
  })
})
