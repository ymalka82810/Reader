// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const speak = vi.fn((u: { onend: () => void }) => queueMicrotask(() => u.onend()))
const voices = [
  { voiceURI: 'he-1', name: 'Hebrew One', lang: 'he-IL' },
  { voiceURI: 'he-2', name: 'Hebrew Two', lang: 'he-IL' },
  { voiceURI: 'en-1', name: 'English One', lang: 'en-US' },
]
const synth = { speak, cancel: vi.fn(), getVoices: () => voices }
Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
vi.stubGlobal('speechSynthesis', synth)
vi.stubGlobal(
  'SpeechSynthesisUtterance',
  class {
    onend = () => {}
    onerror = () => {}
    rate = 1
    lang = ''
    voice: unknown = null
    text: string
    constructor(text: string) {
      this.text = text
    }
  },
)

const { ReadAloudSection } = await import('./ReadAloudSection')

beforeEach(() => {
  localStorage.clear()
  speak.mockClear()
})

describe('ReadAloudSection', () => {
  it('offers the voices of the book language and remembers the one picked', async () => {
    await act(async () => void render(<ReadAloudSection lang="he" rate={1} reading={false} />))
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toHaveLength(3)
    expect(options.slice(1)).toEqual(['Hebrew One', 'Hebrew Two'])
    fireEvent.click(screen.getByRole('option', { name: 'Hebrew Two' }))
    expect(JSON.parse(localStorage.getItem('reader:tts-voices')!)).toEqual({ he: 'he-2' })
  })

  it('plays a sample in the book language, but not over the book being read', async () => {
    const { rerender } = await act(async () => render(<ReadAloudSection lang="he" rate={1.4} reading={false} />))
    const sample = screen.getAllByRole('button').at(-1)!
    fireEvent.click(sample)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0]![0]).toMatchObject({ rate: 1.4, lang: 'he' })
    rerender(<ReadAloudSection lang="he" rate={1} reading />)
    expect(sample).toHaveProperty('disabled', true)
  })
})
