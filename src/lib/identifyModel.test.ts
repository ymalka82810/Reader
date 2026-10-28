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

describe('a model learnt before a clue was added', () => {
  it('keeps what it learnt and starts the new clue from the rules', () => {
    // 12 clues: bias, 12 "agrees", 12 "speaks against"; the bias learnt far from the rules' 0.5
    const w = [3, ...Array<number>(12).fill(1), ...Array<number>(12).fill(-1.5)]
    localStorage.setItem('reader:identify:model', JSON.stringify({ w, n: 40, wrong: 5 }))
    expect(modelReady()).toBe(true)
    // the learnt bias still counts: with no clue at all the chance is the bias's
    expect(predict([], [])).toBeCloseTo(1 / (1 + Math.exp(-3)), 5)
    // the new clue, against, weighs as the rules say (-1.5)
    expect(predict([], ['years'])).toBeCloseTo(1 / (1 + Math.exp(-1.5)), 5)
  })
})
