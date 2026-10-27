import { beforeEach, describe, expect, it } from 'vitest'
import { learnAnswer, modelAllows, modelReady, modelReport, predict } from './identifyModel'

beforeEach(() => localStorage.clear())

describe('the identification model learnt from the user', () => {
  it('starts as the rules were: strong clues agreeing are likely right, a clue against is not, and it never decides yet', () => {
    expect(predict(['name', 'catalog'], [])).toBeGreaterThan(0.85)
    expect(predict(['name'], ['order'])).toBeLessThan(0.85) // one strong clue against one that speaks against: not sure
    expect(modelReady()).toBe(false)
    expect(modelAllows(['running'], ['order'])).toBe(true)
  })

  it('learns that a clue the user keeps contradicting is unreliable', () => {
    const before = predict(['catalog', 'name'], [])
    for (let i = 0; i < 40; i++) learnAnswer(['catalog', 'name'], [], i % 4 === 0)
    expect(predict(['catalog', 'name'], [])).toBeLessThan(before)
  })

  it('decides only after enough answers, wrong names included, and then keeps unlikely names from being saved unasked', () => {
    for (let i = 0; i < 27; i++) learnAnswer(['name', 'meta'], [], true)
    expect(modelReady()).toBe(false)
    for (let i = 0; i < 3; i++) learnAnswer(['words'], ['order'], false)
    expect(modelReport()).toEqual({ answers: 30, wrong: 3, ready: true })
    expect(modelAllows(['name', 'meta'], [])).toBe(true)
    expect(modelAllows(['words'], ['order'])).toBe(false)
  })

  it('ignores an answer without clues', () => {
    learnAnswer([], [], false)
    expect(modelReport().answers).toBe(0)
  })
})
