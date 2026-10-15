import { describe, expect, it } from 'vitest'
import { clampFont, tapZone } from './useBookEvents'

describe('tapZone', () => {
  it('splits the screen into edges and a middle', () => {
    expect(tapZone(10, 1000)).toBe('left')
    expect(tapZone(500, 1000)).toBe('middle')
    expect(tapZone(990, 1000)).toBe('right')
  })
  it('treats the exact edge boundary as middle', () => {
    expect(tapZone(300, 1000)).toBe('middle')
    expect(tapZone(700, 1000)).toBe('middle')
  })
})

describe('clampFont', () => {
  it('clamps and rounds', () => {
    expect(clampFont(2)).toBe(12)
    expect(clampFont(100)).toBe(48)
    expect(clampFont(20.4)).toBe(20)
  })
})
