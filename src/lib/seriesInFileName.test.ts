import { describe, expect, it } from 'vitest'
import { seriesInFileName } from './bookLookup'

// file names from a real library, each with the title its book's own package gives
describe('seriesInFileName', () => {
  it.each([
    ['בני קרטר 1 לשנוא אותו - קלואי וולש (1)', 'לשנוא אותו', 'קלואי וולש', { series: 'בני קרטר', number: '1', title: 'לשנוא אותו' }],
    ['עולם הדיסק 28 מוריס המדהים ומכרסמיו המלומדים (טרי פראצט)', 'מוריס המדהים ומכרסמיו המלומדים', "טרי פראצ'ט", { series: 'עולם הדיסק', number: '28' }],
    ['כובע מלא שמיים (טרי פראצט) עולם הדיסק 32', 'כובע מלא שמיים', "טרי פראצ'ט", { series: 'עולם הדיסק', number: '32' }],
    ['גורלו_של_אפולו_3_המבוך_הבוער_ריק_ריירדן', 'גורלו של אפולו', 'ריק ריירדן', { series: 'גורלו של אפולו', number: '3', title: 'המבוך הבוער' }],
    ['מדריך העצלה לקסם 1 הלן הרפר מכשפה עצלנית', 'מכשפה עצלנית', 'הלן הרפר', { series: 'מדריך העצלה לקסם', number: '1' }],
    ['גיבורי האולימפוס 5 - דם האולימפוס', 'דם האולימפוס V', 'ריק ריירדן', { series: 'גיבורי האולימפוס', number: '5', title: 'דם האולימפוס' }],
  ])('%s', (file, title, author, want) => expect(seriesInFileName(file, title, author)).toMatchObject(want))

  it('tells nothing when the file name is only the title, or the number is no series\' (a joining word, a part)', () => {
    expect(seriesInFileName('לשנוא אותו', 'לשנוא אותו')).toBeUndefined()
    expect(seriesInFileName('לחלום על 10', 'לחלום')).toBeUndefined()
    expect(seriesInFileName('חלק 2 הסוד', 'הסוד')).toBeUndefined()
  })
})
