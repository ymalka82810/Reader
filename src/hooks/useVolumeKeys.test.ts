import { describe, expect, it } from 'vitest'
import { volumeTurn } from './useVolumeKeys'

describe('volume keys', () => {
  it('turn forward with the chosen key and back with the other', () => {
    expect(volumeTurn('down-next', 'down')).toBe(1)
    expect(volumeTurn('down-next', 'up')).toBe(-1)
    expect(volumeTurn('up-next', 'up')).toBe(1)
    expect(volumeTurn('up-next', 'down')).toBe(-1)
    expect(volumeTurn('off', 'down')).toBe(0)
    expect(volumeTurn('down-next', 'mute')).toBe(0)
  })
})
