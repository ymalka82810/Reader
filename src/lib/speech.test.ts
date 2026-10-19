// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor
})

describe('voice labels', () => {
  it('names Android voices by language, numbering a language that has several and marking online ones', async () => {
    const { nativeVoiceLabels } = await import('./speech')
    const out = nativeVoiceLabels([
      { id: 'he-il-x-heb-network', lang: 'he-IL', network: true },
      { id: 'he-il-x-heb-local', lang: 'he-IL', network: false },
      { id: 'en-us-x-sfg-local', lang: 'en-US', network: false },
    ])
    expect(out.map((v) => v.id)).toEqual(['en-us-x-sfg-local', 'he-il-x-heb-local', 'he-il-x-heb-network'])
    expect(out[0]!.label).not.toMatch(/\d/)
    expect(out[1]!.label).toMatch(/ 1$/)
    expect(out[2]!.label).toMatch(/ 2 · /)
  })
})

describe('voices for a book', () => {
  it('keeps the voices of the book language, matching Android’s old Hebrew code', async () => {
    const { voicesFor } = await import('./speech')
    const all = [
      { id: 'a', label: 'A', lang: 'he-IL' },
      { id: 'b', label: 'B', lang: 'iw_IL' },
      { id: 'c', label: 'C', lang: 'en-US' },
    ]
    expect(voicesFor(all, 'he').map((v) => v.id)).toEqual(['a', 'b'])
    expect(voicesFor(all, '')).toHaveLength(3)
  })

  it('remembers one voice per language and forgets it when set back to the default', async () => {
    const { loadVoice, saveVoice } = await import('./speech')
    saveVoice('he-IL', 'v-he')
    saveVoice('en', 'v-en')
    expect(loadVoice('he')).toBe('v-he')
    expect(loadVoice('en-GB')).toBe('v-en')
    saveVoice('he', '')
    expect(loadVoice('he')).toBe('')
    expect(loadVoice('en')).toBe('v-en')
  })

  it('ignores a corrupt remembered choice', async () => {
    localStorage.setItem('reader:tts-voices', 'not json')
    const { loadVoice } = await import('./speech')
    expect(loadVoice('he')).toBe('')
  })

  it('has a sample line in the book language', async () => {
    const { sampleText } = await import('./speech')
    expect(sampleText('he')).toMatch(/\p{Script=Hebrew}/u)
    expect(sampleText('en-US')).toMatch(/voice/)
    expect(sampleText('fr')).toBe('français')
  })
})

describe('Android app', () => {
  function native(reply: (method: string, options?: object) => Promise<unknown>) {
    const nativePromise = vi.fn(reply)
    ;(globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      isPluginAvailable: (name: string) => name === 'NativeTts',
      nativePromise: (_plugin: string, method: string, options?: object) => nativePromise(method, options),
    }
    return nativePromise
  }

  it('speaks through the native plugin, even where the WebView has no speechSynthesis', async () => {
    const calls = native(async (method) => (method === 'voices' ? { voices: [{ id: 'x', lang: 'he-IL', network: false }] } : undefined))
    const { speechEngine } = await import('./speech')
    expect(speechEngine).not.toBeNull()
    await speechEngine!.speak('שלום', { rate: 1.2, lang: 'he', voice: 'x' })
    expect(calls).toHaveBeenCalledWith('speak', { text: 'שלום', rate: 1.2, lang: 'he', voice: 'x' })
    expect((await speechEngine!.voices()).map((v) => v.id)).toEqual(['x'])
    speechEngine!.begin('My book')
    expect(calls).toHaveBeenCalledWith('begin', expect.objectContaining({ title: 'My book' }))
    speechEngine!.cancel()
    expect(calls).toHaveBeenCalledWith('stop', undefined)
  })

  it('tells why the plugin refused', async () => {
    native(async () => {
      throw Object.assign(new Error('no voice'), { code: 'NO_VOICE' })
    })
    const { speechEngine, failureOf } = await import('./speech')
    const e = await speechEngine!.speak('x', { rate: 1 }).catch((err: unknown) => err)
    expect(failureOf(e)).toBe('no-voice')
    expect(failureOf(new Error('other'))).toBeUndefined()
  })
})
