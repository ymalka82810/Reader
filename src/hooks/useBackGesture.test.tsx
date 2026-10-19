// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useBackGesture } from './useBackGesture'

const back = () => window.dispatchEvent(new PopStateEvent('popstate'))

describe('useBackGesture', () => {
  it('keeps a guard entry and restores it after each back', () => {
    const onBack = vi.fn()
    renderHook(() => useBackGesture(onBack))
    expect((history.state as Record<string, unknown>).readerBack).toBe(true)
    history.replaceState(null, '') // what the browser shows after the guard entry is popped
    back()
    expect(onBack).toHaveBeenCalledTimes(1)
    expect((history.state as Record<string, unknown>).readerBack).toBe(true)
  })

  it('calls only the innermost screen', () => {
    const library = vi.fn()
    const reader = vi.fn()
    renderHook(() => useBackGesture(library))
    const inner = renderHook(() => useBackGesture(reader, 1))
    history.replaceState(null, '')
    back()
    expect(reader).toHaveBeenCalledTimes(1)
    expect(library).not.toHaveBeenCalled()
    inner.unmount()
    history.replaceState(null, '')
    back()
    expect(library).toHaveBeenCalledTimes(1)
  })
})
