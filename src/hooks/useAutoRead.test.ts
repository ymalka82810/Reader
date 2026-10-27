// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'
import { useAutoRead } from './useAutoRead'
import { DEFAULT_SECS_PER_KB, PACE_STEP } from '../lib/pace'

const estimate = vi.hoisted(() => vi.fn())

/** a paginated book of one 10 KB section with 3 content pages (`pages` counts the two padding ones) */
function fakeView(over: Record<string, unknown> = {}) {
  const view = new EventTarget() as unknown as FoliateView
  const next = vi.fn(async () => {})
  Object.assign(view, {
    book: { sections: [{ size: 10_000 }] },
    renderer: { scrolled: false, pages: 5, atEnd: false, ...over },
    next,
  })
  return { view, next }
}

function setup(over: Record<string, unknown> = {}, paused = false) {
  const { view, next } = fakeView(over)
  const markActive = vi.fn()
  const props = {
    viewRef: { current: view },
    lastDetail: { current: { section: { current: 0 } } as FoliateRelocateDetail },
    flow: 'paginated' as const,
    paused,
    markActive,
    estimate,
  }
  const hook = renderHook((p: typeof props) => useAutoRead(p), { initialProps: props })
  return { ...hook, props, view, next, markActive }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  estimate.mockReturnValue(DEFAULT_SECS_PER_KB)
})
afterEach(() => vi.useRealTimers())

// default pace * 10 KB / 3 screens
const SCREEN_SECS = (DEFAULT_SECS_PER_KB * 10) / 3

describe('useAutoRead', () => {
  it('starts at the estimated pace and shows the seconds per screen', async () => {
    const { result } = setup()
    expect(result.current.active).toBe(false)
    expect(result.current.secsPerScreen).toBeNull()
    await act(() => result.current.toggle())
    expect(result.current.active).toBe(true)
    expect(result.current.secsPerScreen).toBe(Math.round(SCREEN_SECS))
  })

  it("follows the reader's estimated pace in the book", async () => {
    estimate.mockReturnValue(120)
    const { result } = setup()
    await act(() => result.current.toggle())
    expect(result.current.secsPerScreen).toBe(400)
  })

  it('faster and slower change the shown time at once and are remembered', async () => {
    const { result } = setup()
    await act(() => result.current.toggle())
    act(() => result.current.adjust(true))
    expect(result.current.secsPerScreen).toBe(Math.round(SCREEN_SECS / PACE_STEP))
    expect(Number(localStorage.getItem('reader:autoPaceFactor'))).toBeCloseTo(1 / PACE_STEP)
    act(() => result.current.adjust(false))
    act(() => result.current.adjust(false))
    expect(result.current.secsPerScreen).toBe(Math.round(SCREEN_SECS * PACE_STEP))
  })

  it('remembers faster/slower as a factor of the estimate, so it carries to a book of another pace', async () => {
    localStorage.setItem('reader:autoPaceFactor', '0.5')
    estimate.mockReturnValue(120)
    const { result } = setup()
    await act(() => result.current.toggle())
    expect(result.current.secsPerScreen).toBe(200)
  })

  it('does nothing without a view', async () => {
    const { result, props } = setup()
    props.viewRef.current = null as never
    await act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
  })

  it('turns the next page when the screen time is up', async () => {
    const { result, next } = setup()
    await act(() => result.current.toggle())
    await act(() => vi.advanceTimersByTimeAsync(SCREEN_SECS * 1000 - 100))
    expect(next).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(next).toHaveBeenCalledTimes(1)
    // and the clock runs again for the following page
    await act(() => vi.advanceTimersByTimeAsync(SCREEN_SECS * 1000))
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('a manual page turn restarts the clock', async () => {
    const { result, view, next } = setup()
    await act(() => result.current.toggle())
    await act(() => vi.advanceTimersByTimeAsync(SCREEN_SECS * 1000 - 1000))
    view.dispatchEvent(new Event('relocate'))
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(next).not.toHaveBeenCalled()
  })

  it('holds still while paused and resumes afterwards', async () => {
    const { result, rerender, props, next } = setup({}, true)
    await act(() => result.current.toggle())
    await act(() => vi.advanceTimersByTimeAsync(SCREEN_SECS * 3000))
    expect(next).not.toHaveBeenCalled()
    rerender({ ...props, paused: false })
    await act(() => vi.advanceTimersByTimeAsync(SCREEN_SECS * 1000 + 100))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('stops at the end of the book', async () => {
    const { result, next } = setup({ atEnd: true })
    await act(() => result.current.toggle())
    await act(() => vi.advanceTimersByTimeAsync(SCREEN_SECS * 1000 + 100))
    expect(next).not.toHaveBeenCalled()
    expect(result.current.active).toBe(false)
  })

  it('toggling again stops it and no page is turned afterwards', async () => {
    const { result, next } = setup()
    await act(() => result.current.toggle())
    await act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(SCREEN_SECS * 5000))
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps the reading tracker alive on long pages', async () => {
    const { result, markActive } = setup()
    await act(() => result.current.toggle())
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(markActive).toHaveBeenCalledTimes(1)
  })
})
