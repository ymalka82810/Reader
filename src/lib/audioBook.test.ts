import { describe, expect, it } from 'vitest'
import { chapterAt, clampSpeed, formatTime, isAudio, locTime, readAudioMeta, timeLoc } from './audioBook'

/** one second of 8 kHz mono silence as a WAV file */
function wav(): File {
  const n = 8000
  const b = new DataView(new ArrayBuffer(44 + n))
  const s = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)))
  s(0, 'RIFF')
  b.setUint32(4, 36 + n, true)
  s(8, 'WAVEfmt ')
  b.setUint32(16, 16, true)
  b.setUint16(20, 1, true)
  b.setUint16(22, 1, true)
  b.setUint32(24, 8000, true)
  b.setUint32(28, 8000, true)
  b.setUint16(32, 1, true)
  b.setUint16(34, 8, true)
  s(36, 'data')
  b.setUint32(40, n, true)
  return new File([b.buffer], 'one.wav', { type: 'audio/wav' })
}

describe('audioBook', () => {
  it('recognises audio files by extension or type', () => {
    expect(isAudio({ name: 'book.M4B', type: '' })).toBe(true)
    expect(isAudio({ name: 'x.mp3', type: '' })).toBe(true)
    expect(isAudio({ name: 'x', type: 'audio/mpeg' })).toBe(true)
    expect(isAudio({ name: 'x.epub', type: 'application/epub+zip' })).toBe(false)
  })

  it('round-trips a time through its location string', () => {
    expect(locTime(timeLoc(83.46))).toBe(83.5)
    expect(locTime(timeLoc(-5))).toBe(0)
    expect(locTime('epubcfi(/6/4)')).toBeUndefined()
    expect(locTime('t:abc')).toBeUndefined()
    expect(locTime(undefined)).toBeUndefined()
  })

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(75)).toBe('1:15')
    expect(formatTime(3725)).toBe('1:02:05')
    expect(formatTime(NaN)).toBe('0:00')
  })

  it('finds the chapter playing at a time', () => {
    const ch = [0, 100, 250].map((start, i) => ({ title: `c${i}`, start }))
    expect(chapterAt(ch, 0)).toBe(0)
    expect(chapterAt(ch, 99.9)).toBe(0)
    expect(chapterAt(ch, 100)).toBe(1)
    expect(chapterAt(ch, 9999)).toBe(2)
    expect(chapterAt([{ title: 'a', start: 10 }], 5)).toBe(-1)
    expect(chapterAt([], 5)).toBe(-1)
  })

  it('reads the length of an audio file', async () => {
    const m = await readAudioMeta(wav())
    expect(m.info.duration).toBeCloseTo(1, 1)
    expect(m.info.chapters).toEqual([])
    expect(m.title).toBe('')
  })

  it('keeps the speed in range and in 0.05 steps', () => {
    expect(clampSpeed(0.1)).toBe(0.5)
    expect(clampSpeed(9)).toBe(3)
    expect(clampSpeed(1.27)).toBe(1.25)
  })
})
