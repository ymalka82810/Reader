// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'

type Utterance = { text: string; rate: number; lang: string; voice: { voiceURI: string } | null; onend: () => void }
const spoken: { text: string; rate: number; lang: string; voice?: string }[] = []
const speak = vi.fn((u: Utterance) => {
  spoken.push({ text: u.text, rate: u.rate, lang: u.lang, voice: u.voice?.voiceURI })
  queueMicrotask(() => u.onend())
})
const cancel = vi.fn()
const getVoices = () => [{ voiceURI: 'en-1', name: 'English 1', lang: 'en-US' }]
class FakeUtterance {
  onend: () => void = () => {}
  onerror: () => void = () => {}
  rate = 1
  lang = ''
  voice: { voiceURI: string } | null = null
  text: string
  constructor(text: string) {
    this.text = text
  }
}
// readAloudSupported is decided when the module loads, so the fakes go in first
Object.defineProperty(window, 'speechSynthesis', { value: { speak, cancel, getVoices }, configurable: true })
vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices })
vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)

const { useReadAloud, MAX_RATE, MIN_RATE } = await import('./useReadAloud')

const ssml = (...parts: string[]) => `<speak xmlns="http://www.w3.org/2001/10/synthesis">${parts.join('')}</speak>`

/** each section is a list of SSML blocks handed out by tts.start() and tts.next() */
function setup(sections: string[][], language = 'en') {
  let section = 0
  let chunk = 0
  const view = {
    book: { sections: sections.map(() => ({})), metadata: { language } },
    renderer: { scrollToAnchor: vi.fn() },
    initTTS: vi.fn(async () => {}),
    goTo: vi.fn(async (i: number) => void (section = i)),
    getCFI: vi.fn((i: number) => `cfi-${i}`),
    addAnnotation: vi.fn(async () => {}),
    deleteAnnotation: vi.fn(async () => {}),
    tts: {
      start: vi.fn(() => ((chunk = 0), sections[section]?.[0])),
      next: vi.fn(() => sections[section]?.[++chunk]),
      from: vi.fn(() => sections[section]?.[0]),
      setMark: vi.fn(),
    },
  } as unknown as FoliateView
  const lang = { current: '' }
  // stable refs, like the real ones: new objects per render would re-create stop() and silence the reading
  const viewRef = { current: view }
  const lastDetail = { current: { section: { current: 0, total: sections.length } } as FoliateRelocateDetail }
  const hook = renderHook(() => useReadAloud({ viewRef, lastDetail, lang }))
  return { ...hook, view, lang }
}

beforeEach(() => {
  spoken.length = 0
  speak.mockClear()
  cancel.mockClear()
  localStorage.clear()
})

describe('useReadAloud rate', () => {
  it('clamps and remembers changes', () => {
    const { result } = setup([[]])
    expect(result.current.rate).toBe(1)
    act(() => result.current.setRate(9))
    expect(result.current.rate).toBe(MAX_RATE)
    act(() => result.current.setRate(0.01))
    expect(result.current.rate).toBe(MIN_RATE)
    act(() => result.current.setRate(1.26))
    expect(result.current.rate).toBe(1.3)
    expect(localStorage.getItem('reader:tts-rate')).toBe('1.3')
  })

  it('loads the remembered rate', () => {
    localStorage.setItem('reader:tts-rate', '1.7')
    expect(setup([[]]).result.current.rate).toBe(1.7)
  })

  it('ignores a corrupt remembered rate', () => {
    localStorage.setItem('reader:tts-rate', 'fast')
    expect(setup([[]]).result.current.rate).toBe(1)
  })
})

describe('useReadAloud reading', () => {
  it('speaks the sentences of a block in order, marking each one', async () => {
    const { result, view } = setup([[ssml('<mark name="a"/>One. <mark name="b"/>Two.')]])
    act(() => result.current.setRate(1.5))
    await act(() => result.current.toggle())
    await waitFor(() => expect(result.current.active).toBe(false))
    expect(spoken.map((s) => s.text.trim())).toEqual(['One.', 'Two.'])
    expect(spoken[0]).toMatchObject({ rate: 1.5, lang: 'en' })
    expect((view.tts.setMark as ReturnType<typeof vi.fn>).mock.calls).toEqual([['a'], ['b']])
  })

  it('continues through the blocks and the sections of the book', async () => {
    const { result, view } = setup([
      [ssml('<mark name="a"/>First.'), ssml('<mark name="b"/>Second.')],
      [ssml('<mark name="c"/>Third.')],
    ])
    await act(() => result.current.toggle())
    await waitFor(() => expect(result.current.active).toBe(false))
    expect(spoken.map((s) => s.text.trim())).toEqual(['First.', 'Second.', 'Third.'])
    expect(view.goTo).toHaveBeenCalledWith(1)
  })

  it('the language given by the reader wins over the book metadata', async () => {
    const { result, lang } = setup([[ssml('<mark name="a"/>Shalom.')]], 'en')
    lang.current = 'he'
    await act(() => result.current.toggle())
    await waitFor(() => expect(result.current.active).toBe(false))
    expect(spoken[0]?.lang).toBe('he')
  })

  it('reads in the voice chosen for the book language', async () => {
    localStorage.setItem('reader:tts-voices', JSON.stringify({ en: 'en-1' }))
    const { result } = setup([[ssml('<mark name="a"/>Hello.')]], 'en-US')
    await act(() => result.current.toggle())
    await waitFor(() => expect(result.current.active).toBe(false))
    expect(spoken[0]?.voice).toBe('en-1')
  })

  it('toggling while reading stops the speech', async () => {
    let finish!: () => void
    speak.mockImplementationOnce((u: Utterance) => void (finish = u.onend))
    const { result } = setup([[ssml('<mark name="a"/>One. <mark name="b"/>Two.')]])
    await act(async () => void result.current.toggle())
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
    await act(async () => void result.current.toggle())
    expect(result.current.active).toBe(false)
    expect(cancel).toHaveBeenCalled()
    finish()
    await new Promise((r) => setTimeout(r, 0))
    // the second sentence is never spoken once stopped
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('leaving the book silences it', async () => {
    speak.mockImplementationOnce(() => {})
    const { result, unmount } = setup([[ssml('<mark name="a"/>One.')]])
    await act(async () => void result.current.toggle())
    await waitFor(() => expect(speak).toHaveBeenCalled())
    cancel.mockClear()
    unmount()
    expect(cancel).toHaveBeenCalled()
  })
})
