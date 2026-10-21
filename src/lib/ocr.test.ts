import { describe, expect, it } from 'vitest'
import { cleanLines } from './ocr'

describe('cleanLines', () => {
  it('keeps confident lines with letters and drops smudges and unsure reads', () => {
    expect(
      cleanLines([
        { text: '  גנב  הברק ', confidence: 91 },
        { text: '~ | .', confidence: 90 },
        { text: 'x', confidence: 95 },
        { text: 'Rick Riordan', confidence: 40 },
        { text: 'ריק ריירדן', confidence: 72 },
      ]),
    ).toEqual(['גנב הברק', 'ריק ריירדן'])
  })
})
