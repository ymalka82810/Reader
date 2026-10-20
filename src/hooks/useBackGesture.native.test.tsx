// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

describe('useBackGesture in the Android app', () => {
  it('takes the back gesture from the native "back" event, not from the history', async () => {
    let native: (() => void) | undefined
    const addListener = vi.fn((_p: string, _e: string, cb: () => void) => (native = cb))
    ;(globalThis as unknown as { Capacitor: object }).Capacitor = { isNativePlatform: () => true, addListener }
    const { useBackGesture } = await import('./useBackGesture')
    const library = vi.fn()
    const reader = vi.fn()
    renderHook(() => useBackGesture(library))
    const inner = renderHook(() => useBackGesture(reader, 1))
    expect(addListener).toHaveBeenCalledWith('AppUpdater', 'back', expect.any(Function))
    native!()
    expect(reader).toHaveBeenCalledTimes(1)
    expect(library).not.toHaveBeenCalled()
    inner.unmount()
    native!()
    expect(library).toHaveBeenCalledTimes(1)
  })

  it('an inactive menu does not take the back', async () => {
    const { useBackGesture } = await import('./useBackGesture')
    const menu = vi.fn()
    renderHook(() => useBackGesture(menu, 3, false))
    expect(menu).not.toHaveBeenCalled()
  })
})
