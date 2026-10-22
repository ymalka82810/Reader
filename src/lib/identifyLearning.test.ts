import { beforeEach, describe, expect, it } from 'vitest'
import { blocks, confirmName, declineName, isConfirmed, learnFromEdit, recordOutcome, rememberAuto, samePlace, trusted, wasDeclined } from './identifyLearning'

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
