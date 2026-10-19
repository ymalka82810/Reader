import { describe, expect, it } from 'vitest'
import { customFontFace, customFontUrl, releaseCustomFontUrl } from './customFont'

describe('custom font url', () => {
  it('turns the stored data: URL into one blob: URL with the same bytes', async () => {
    const url = await customFontUrl({ name: 'f', dataUrl: 'data:font/ttf;base64,AAEC' })
    expect(url.startsWith('blob:')).toBe(true)
    expect([...new Uint8Array(await (await fetch(url)).arrayBuffer())]).toEqual([0, 1, 2])
    expect(customFontFace(url)).toContain(`url("${url}")`)
    releaseCustomFontUrl(url)
  })

  it('falls back to the data: URL when it cannot be read', async () => {
    const dataUrl = 'not a url'
    expect(await customFontUrl({ name: 'f', dataUrl })).toBe(dataUrl)
    expect(() => releaseCustomFontUrl(dataUrl)).not.toThrow()
  })
})
