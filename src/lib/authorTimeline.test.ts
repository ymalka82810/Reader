import { expect, it } from 'vitest'
import { authorByTimeline, timelineVerdict } from './authorTimeline'

const w = (year: number, series = '') => ({ year, series })

it('speaks against a book from well before the author wrote, never against one after the last', () => {
  const works = [w(2010), w(2012), w(2015)]
  expect(timelineVerdict(works, 1990)).toBe('against')
  expect(timelineVerdict(works, 2008)).toBeUndefined()
  expect(timelineVerdict(works, 2030)).toBeUndefined()
  // two books only: not enough to know when the author started
  expect(timelineVerdict(works.slice(0, 2), 1990)).toBeUndefined()
})

it('speaks against a series placed in years the author was writing another series altogether', () => {
  const works = [w(2000, 'א'), w(2002, 'א'), w(2010, 'ב'), w(2013, 'ב')]
  expect(timelineVerdict(works, 2011, 'א')).toBe('against')
  expect(timelineVerdict(works, 2004, 'א')).toBeUndefined()
  // years the author wrote nothing else: a series may come back after a break
  expect(timelineVerdict(works, 2020, 'א')).toBeUndefined()
  // one book of the series known is not its years
  expect(timelineVerdict([w(2000, 'א'), ...works.slice(2)], 2011, 'א')).toBeUndefined()
})

it('gives a book with no author the one author whose translator, publisher and years it shares', () => {
  const dana = { author: 'דנה', works: [{ year: 2010, house: ['t:רון לוי', 'p:כנרת'] }, { year: 2014, house: ['t:רון לוי', 'p:כנרת'] }] }
  const eli = { author: 'אלי', works: [{ year: 1990, house: ['t:רון לוי', 'p:עם'] }, { year: 1992, house: ['p:עם'] }] }
  expect(authorByTimeline(2012, ['t:רון לוי', 'p:כנרת'], [dana, eli])).toBe('דנה')
  // years far from hers
  expect(authorByTimeline(1980, ['t:רון לוי', 'p:כנרת'], [dana, eli])).toBeUndefined()
  // a translator both share, and no publisher to tell them apart
  expect(authorByTimeline(undefined, ['t:רון לוי'], [dana, eli])).toBeUndefined()
  // no translator: a publisher alone says nothing of an author
  expect(authorByTimeline(2012, ['p:כנרת'], [dana, eli])).toBeUndefined()
})
