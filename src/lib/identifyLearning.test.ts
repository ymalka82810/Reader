import { beforeEach, describe, expect, it } from 'vitest'
import { blocks, confirmName, declineName, dependents, isConfirmed, learnFromEdit, learntSources, needsMoreProof, recentPrecision, recordOutcome, rememberAuto, samePlace, sources, trusted, wasDeclined, learnFromBlind, clueStats } from './identifyLearning'

beforeEach(() => localStorage.clear())

describe('the clues learnt from the user', () => {
  it('starts as the fixed rules were: the strong clues count, the weak ones not, every clue against blocks', () => {
    expect(trusted('name')).toBe(true)
    expect(trusted('catalog')).toBe(true)
    expect(trusted('running')).toBe(false)
    expect(trusted('order')).toBe(false)
    expect(blocks('order')).toBe(true)
  })

  it('stops counting a clue that agreed with names the user turned down', () => {
    recordOutcome(['catalog'], [], false)
    expect(trusted('catalog')).toBe(true) // one answer does not outweigh the belief
    recordOutcome(['catalog'], [], false)
    expect(trusted('catalog')).toBe(false)
  })

  it('counts a weak clue that agreed with names the user approved again and again', () => {
    for (let i = 0; i < 6; i++) recordOutcome(['running'], [], true)
    expect(trusted('running')).toBe(true)
  })

  it('no more blocks with a clue whose objections the user overrode', () => {
    for (let i = 0; i < 4; i++) recordOutcome([], ['order'], true)
    expect(blocks('order')).toBe(false)
  })

  it('asks for one more clue while the latest names saved by themselves were wrong too often, and forgets it as they mend', () => {
    const wrong = "פרסי ג'קסון 9 - אחר"
    for (let i = 0; i < 20; i++) rememberAuto(`b${i}`, "פרסי ג'קסון 2 - ים המפלצות")
    expect(needsMoreProof()).toBe(false)
    for (let i = 0; i < 3; i++) learnFromEdit(`b${i}`, wrong)
    expect(recentPrecision()).toBe(0.85)
    expect(needsMoreProof()).toBe(true)
    // later names that stay push the wrong ones out of the window
    for (let i = 20; i < 70; i++) rememberAuto(`b${i}`, "פרסי ג'קסון 2 - ים המפלצות")
    expect(needsMoreProof()).toBe(false)
  })

  it('does not judge before enough names were saved', () => {
    for (let i = 0; i < 5; i++) rememberAuto(`c${i}`, "פרסי ג'קסון 2 - ים המפלצות")
    for (let i = 0; i < 5; i++) learnFromEdit(`c${i}`, "פרסי ג'קסון 9 - אחר")
    expect(recentPrecision()).toBeUndefined()
    expect(needsMoreProof()).toBe(false)
  })

  it('judges a name saved by itself by the place the user kept for it', () => {
    rememberAuto('a', "פרסי ג'קסון 2 - ים המפלצות", ['name', 'catalog'])
    rememberAuto('b', "פרסי ג'קסון 2 - ים המפלצות", ['name', 'catalog'])
    rememberAuto('c', "פרסי ג'קסון 2 - ים המפלצות", ['name', 'catalog'])
    learnFromEdit('a', "פרסי ג'קסון 3 - קללת הטיטאן")
    learnFromEdit('b', "פרסי ג'קסון 4 - הקרב על המבוך")
    learnFromEdit('c', "פרסי ג'קסון 5 - האולימפי האחרון")
    expect(trusted('catalog')).toBe(false)
    expect(isConfirmed('a', "פרסי ג'קסון 3 - קללת הטיטאן")).toBe(true)
  })
})

describe('anchors', () => {
  it('keeps a name the user gave while the book has it', () => {
    confirmName('a', 'שם')
    expect(isConfirmed('a', 'שם')).toBe(true)
    expect(isConfirmed('a', 'שם אחר')).toBe(false)
  })

  it('remembers names the user turned down, until the user gives one', () => {
    declineName('a', 'X 1 - Y')
    expect(wasDeclined('a', 'X 1 - Y')).toBe(true)
    confirmName('a', 'Z')
    expect(wasDeclined('a', 'X 1 - Y')).toBe(false)
  })

  it('compares names by their place: the same series and number, in any spelling of the title', () => {
    expect(samePlace("פרסי ג'קסון 2 - ים המפלצות", "פרסי ג'קסון 2 - ים המפלצות (מהדורה חדשה)")).toBe(true)
    expect(samePlace("פרסי ג'קסון 2 - ים המפלצות", "פרסי ג'קסון 3 - ים המפלצות")).toBe(false)
  })
})

describe('the report', () => {
  it('counts the answers, the names saved alone and those corrected later', async () => {
    const { countOutcome, outcomes } = await import('./identifyLearning')
    countOutcome('approved')
    countOutcome('declined')
    rememberAuto('a', "פרסי ג'קסון 2 - ים המפלצות", ['name'])
    learnFromEdit('a', "פרסי ג'קסון 3 - קללת הטיטאן")
    expect(outcomes()).toEqual({ approved: 1, corrected: 0, declined: 1, autoSaved: 1, autoCorrected: 1 })
  })

  it("tells where the library's books stand", async () => {
    const { coverage } = await import('./identifyLearning')
    confirmName('b', 'גנב הברק')
    expect(
      coverage([
        { id: 'a', title: "פרסי ג'קסון 1 - גנב הברק" },
        { id: 'b', title: 'גנב הברק' },
      ]),
    ).toEqual({ total: 2, numbered: 1, seriesOnly: 0, none: 1, confirmed: 1 })
  })
})

describe('independent sources', () => {
  it('counts the clues of one source once: the file name and its package, the years and the pace', () => {
    expect(sources(['name', 'meta'])).toBe(1)
    expect(sources(['name', 'copyright'])).toBe(2)
    expect(sources(['years', 'rhythm', 'list'])).toBe(2)
  })
  it('learns that two clues are one source when they are wrong together again and again', () => {
    for (let i = 0; i < 3; i++) recordOutcome(['list', 'page'], [], false)
    expect(learntSources()).toEqual([['list', 'page']])
    expect(sources(['list', 'page'])).toBe(1)
    // a clue that is wrong on its own as often is not one source with the other
    for (let i = 0; i < 4; i++) recordOutcome(['list', 'catalog'], [], false)
    for (let i = 0; i < 6; i++) recordOutcome(['list'], [], false)
    expect(sources(['list', 'catalog'])).toBe(2)
  })
})

describe('the books a name leaned on', () => {
  it('finds the names saved by themselves that leaned on a corrected book', () => {
    rememberAuto('b', "פרסי ג'קסון 2 - ים המפלצות", ['years'], [], ['a', 'c'])
    rememberAuto('d', "פרסי ג'קסון 4 - הקרב על המבוך", ['years'], [], ['c'])
    expect(dependents(['a'])).toEqual(['b'])
    expect(dependents(['c']).sort()).toEqual(['b', 'd'])
    expect(dependents(['b'])).toEqual([])
  })
})

describe('the blind test teaches', () => {
  it('counts a finding as half an answer, once per book, taking back its earlier one when it changes', () => {
    localStorage.clear()
    learnFromBlind('a', ['name', 'make'], ['timeline'], true)
    expect(clueStats().make?.for).toEqual({ right: 0.5, wrong: 0 })
    expect(clueStats().timeline?.against).toEqual({ right: 0, wrong: 0.5 })
    // the same finding again teaches nothing more
    learnFromBlind('a', ['make', 'name'], ['timeline'], true)
    expect(clueStats().make?.for).toEqual({ right: 0.5, wrong: 0 })
    // the book tested again, now wrong: the earlier finding is taken back
    learnFromBlind('a', ['make'], [], false)
    expect(clueStats().make?.for).toEqual({ right: 0, wrong: 0.5 })
    expect(clueStats().name?.for).toEqual({ right: 0, wrong: 0 })
    expect(clueStats().timeline?.against).toEqual({ right: 0, wrong: 0 })
    expect(JSON.parse(localStorage.getItem('reader:identify:model') ?? '{}').n).toBe(1)
    // tested again with no clue speaking: the finding is taken back, and none is kept
    learnFromBlind('a', [], [], true)
    expect(clueStats().make?.for).toEqual({ right: 0, wrong: 0 })
    expect(JSON.parse(localStorage.getItem('reader:identify:blind-learnt') ?? '{}').a).toBeUndefined()
  })
})
