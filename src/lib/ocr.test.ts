import { describe, expect, it } from 'vitest'
import { isOcrNoise, ocrLinesToLines } from './ocr'

const box = (y0: number, y1: number) => ({ x0: 10, y0, x1: 300, y1 })

describe('ocrLinesToLines', () => {
  it('flips pixel coordinates so earlier lines have a larger y', () => {
    const out = ocrLinesToLines(
      [
        { text: 'ראשונה\n', confidence: 90, bbox: box(100, 130) },
        { text: 'שנייה\n', confidence: 90, bbox: box(200, 230) },
      ],
      1000,
    )
    expect(out.map((l) => l.text)).toEqual(['ראשונה', 'שנייה'])
    expect(out[0]!.y).toBeGreaterThan(out[1]!.y)
    expect(out[0]).toMatchObject({ h: 30, x0: 10, x1: 300 })
  })
  it('drops low-confidence and empty lines', () => {
    const out = ocrLinesToLines(
      [
        { text: 'רעש', confidence: 10, bbox: box(0, 20) },
        { text: ' \n', confidence: 95, bbox: box(30, 50) },
        { text: 'טוב', confidence: 80, bbox: box(60, 80) },
      ],
      500,
    )
    expect(out.map((l) => l.text)).toEqual(['טוב'])
  })
})

describe('isOcrNoise', () => {
  it('rejects symbol-only and mostly-symbol lines', () => {
    expect(isOcrNoise('— | ~ .', 90)).toBe(true)
    expect(isOcrNoise('a|~|~|', 90)).toBe(true)
  })
  it('rejects short fragments unless the engine is sure', () => {
    expect(isOcrNoise('וא', 50)).toBe(true)
    expect(isOcrNoise('12', 95)).toBe(false)
  })
  it('keeps ordinary text', () => {
    expect(isOcrNoise('זה משפט רגיל, עם פסיק.', 60)).toBe(false)
  })
})
