// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMeta } from '../lib/db'

const importFile = vi.hoisted(() => vi.fn())
const takeSharedFiles = vi.hoisted(() => vi.fn())
const onLaunchFiles = vi.hoisted(() => vi.fn())
vi.mock('../lib/importBook', async (orig) => ({ ...(await orig<object>()), importFile }))
vi.mock('../lib/inbox', () => ({ takeSharedFiles, onLaunchFiles }))
const service = vi.hoisted(() => ({
  startImportService: vi.fn(async () => false),
  updateImportService: vi.fn(),
  stopImportService: vi.fn(),
}))
vi.mock('../lib/deviceBooks', async (orig) => ({ ...(await orig<object>()), ...service }))

const { useImport } = await import('./useImport')
const { DeferredDuplicate } = await import('../lib/importBook')

const file = (name: string) => new File(['x'], name)
const existing = { id: 'old', title: 'Old' } as BookMeta

function setup() {
  const deps = { refresh: vi.fn(async () => {}), setError: vi.fn(), showToast: vi.fn() }
  const hook = renderHook(() => useImport(deps))
  return { ...hook, ...deps }
}

beforeEach(() => {
  importFile.mockReset()
  importFile.mockResolvedValue({})
  takeSharedFiles.mockReset()
  takeSharedFiles.mockResolvedValue([])
  onLaunchFiles.mockReset()
  service.startImportService.mockReset()
  service.startImportService.mockResolvedValue(false)
  service.updateImportService.mockReset()
  service.stopImportService.mockReset()
})

describe('useImport', () => {
  it('imports each file, refreshing after every one, and ends idle', async () => {
    const { result, refresh, setError } = setup()
    await act(() => result.current.addFiles([file('a.epub'), file('b.epub')]))
    expect(importFile).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(3) // once per file and a final one
    expect(result.current.running).toBe(false)
    expect(result.current.message).toBeUndefined()
    expect(setError).toHaveBeenLastCalledWith(undefined)
    expect(result.current.batch).toBeUndefined()
  })

  it('collects failures per file and reports them all, without stopping the rest', async () => {
    importFile.mockRejectedValueOnce(new Error('bad one')).mockResolvedValueOnce({}).mockRejectedValueOnce('worse')
    const { result, setError } = setup()
    await act(() => result.current.addFiles([file('a.epub'), file('b.epub'), file('c.epub')]))
    expect(importFile).toHaveBeenCalledTimes(3)
    expect(setError).toHaveBeenLastCalledWith('a.epub: bad one\nc.epub: worse')
  })

  it('asks about a duplicate straight away for a single file', async () => {
    importFile.mockImplementation(async (_f, _p, onDuplicate) => onDuplicate(existing))
    const { result } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub')])
    })
    await vi.waitFor(() => expect(result.current.dupAsk).toBeDefined())
    expect(result.current.dupAsk).toMatchObject({ file: 'a.epub', existing })
    await act(async () => {
      result.current.dupAsk!.answer('skip')
      await done
    })
  })

  it('defers duplicates in a batch and commits the choices made together', async () => {
    const commit = vi.fn(async () => undefined)
    importFile.mockRejectedValueOnce(new DeferredDuplicate(existing, 'Old', commit)).mockResolvedValueOnce({})
    const { result, setError } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub'), file('b.epub')])
    })
    await vi.waitFor(() => expect(result.current.dupBatch).toBeDefined())
    expect(result.current.dupBatch!.items).toMatchObject([{ name: 'a.epub', title: 'Old', choice: 'skip' }])
    await act(async () => {
      result.current.dupBatch!.done(['replace'])
      await done
    })
    expect(commit).toHaveBeenCalledWith('replace')
    expect(result.current.dupBatch).toBeUndefined()
    expect(setError).toHaveBeenLastCalledWith(undefined)
  })

  it('reports a failing commit of a deferred duplicate', async () => {
    const commit = vi.fn(async () => {
      throw new Error('disk full')
    })
    importFile.mockRejectedValueOnce(new DeferredDuplicate(existing, 'Old', commit)).mockResolvedValueOnce({})
    const { result, setError } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub'), file('b.epub')])
    })
    await vi.waitFor(() => expect(result.current.dupBatch).toBeDefined())
    await act(async () => {
      result.current.dupBatch!.done(['add'])
      await done
    })
    expect(setError).toHaveBeenLastCalledWith('a.epub: disk full')
  })

  it('imports files shared into the app on startup', async () => {
    takeSharedFiles.mockResolvedValue([file('shared.epub')])
    setup()
    await vi.waitFor(() => expect(importFile).toHaveBeenCalledTimes(1))
    expect(importFile.mock.calls[0]![0].name).toBe('shared.epub')
  })

  it('imports files the OS opens the app with', async () => {
    setup()
    expect(onLaunchFiles).toHaveBeenCalledTimes(1)
    const cb = onLaunchFiles.mock.calls[0]![0] as (f: File[]) => void
    await act(async () => cb([file('launched.epub')]))
    await vi.waitFor(() => expect(importFile).toHaveBeenCalledTimes(1))
  })

  it('warns before the page unloads only while importing', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { result } = setup()
    await act(() => result.current.addFiles([file('a.epub')]))
    const warn = add.mock.calls.find((c) => c[0] === 'beforeunload')![1]
    expect(remove).toHaveBeenCalledWith('beforeunload', warn)
  })
  it('reads a lazy file only when its turn comes', async () => {
    const order: string[] = []
    importFile.mockImplementation(async (f: File) => void order.push(`import ${f.name}`))
    const lazy = (name: string) => ({ name, load: async () => (order.push(`load ${name}`), file(name)) })
    const { result } = setup()
    await act(() => result.current.addFiles([lazy('a.epub'), lazy('b.epub')]))
    expect(order).toEqual(['load a.epub', 'import a.epub', 'load b.epub', 'import b.epub'])
  })

  it('with skipDuplicates, skips books already in the library without asking or reporting, and reports each item', async () => {
    const { ImportError } = await import('../lib/errors')
    const { t } = await import('../i18n')
    importFile
      .mockImplementationOnce(async (_f, _p, onDuplicate) => {
        expect(await onDuplicate(existing)).toBe('skip')
        throw new ImportError(t('import.exists'))
      })
      .mockRejectedValueOnce(new Error('broken'))
      .mockResolvedValueOnce({})
    const onEach = vi.fn()
    const { result, setError } = setup()
    await act(() => result.current.addFiles([file('a.epub'), file('b.pdf'), file('c.epub')], { skipDuplicates: true, onEach }))
    expect(result.current.dupBatch).toBeUndefined()
    expect(setError).toHaveBeenLastCalledWith('b.pdf: broken')
    expect(onEach.mock.calls.map((c) => c[0])).toEqual([0, 1, 2])
  })

  it('cancel stops the queue: the book in progress is dropped, the rest are not read, nothing is reported as failed', async () => {
    const seen: string[] = []
    importFile.mockImplementation(
      (f: File, _p: unknown, _d: unknown, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          seen.push(f.name)
          signal.addEventListener('abort', () => reject(signal.reason))
          if (f.name === 'a.epub') resolve({})
        }),
    )
    const { result, setError, showToast, refresh } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub'), file('b.epub'), file('c.epub')])
    })
    await vi.waitFor(() => expect(seen).toEqual(['a.epub', 'b.epub']))
    expect(result.current.running).toBe(true)
    await act(async () => {
      result.current.cancel()
      await done
    })
    expect(seen).toEqual(['a.epub', 'b.epub']) // c.epub never started
    expect(result.current.running).toBe(false)
    expect(result.current.batch).toBeUndefined()
    expect(setError).toHaveBeenLastCalledWith(undefined)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalled()
  })

  it('files added while the queue is running join it instead of starting a second one', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const order: string[] = []
    importFile.mockImplementation(async (f: File) => {
      order.push(f.name)
      if (f.name === 'a.epub') await gate
      return {}
    })
    const { result } = setup()
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.addFiles([file('a.epub')])
    })
    await vi.waitFor(() => expect(order).toEqual(['a.epub']))
    act(() => {
      second = result.current.addFiles([file('b.epub'), file('c.epub')])
    })
    expect(result.current.batch).toMatchObject({ done: 0, total: 3 })
    await act(async () => {
      release()
      await Promise.all([first, second])
    })
    expect(order).toEqual(['a.epub', 'b.epub', 'c.epub'])
    expect(result.current.running).toBe(false)
  })

  it('keeps going when the library is left and shows the progress again when it comes back', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    importFile.mockImplementation(async () => {
      await gate
      return {}
    })
    const first = setup()
    let done!: Promise<void>
    act(() => {
      done = first.result.current.addFiles([file('a.epub'), file('b.epub')])
    })
    await vi.waitFor(() => expect(first.result.current.running).toBe(true))
    first.unmount()
    const back = setup()
    expect(back.result.current.running).toBe(true)
    expect(back.result.current.batch).toMatchObject({ done: 0, total: 2 })
    await act(async () => {
      release()
      await done
    })
    expect(back.result.current.running).toBe(false)
    expect(back.refresh).toHaveBeenCalled()
  })

  it('cancelOne skips a waiting book without touching the others', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const order: string[] = []
    importFile.mockImplementation(async (f: File) => {
      order.push(f.name)
      if (f.name === 'a.epub') await gate
      return {}
    })
    const onEach = vi.fn()
    const { result, setError } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub'), file('b.epub'), file('c.epub')], { onEach })
    })
    await vi.waitFor(() => expect(result.current.queue.map((q) => q.name)).toEqual(['a.epub', 'b.epub', 'c.epub']))
    expect(result.current.queue[0]).toMatchObject({ active: true })
    act(() => result.current.cancelOne(result.current.queue[1]!.id))
    expect(result.current.queue.map((q) => q.name)).toEqual(['a.epub', 'c.epub'])
    await act(async () => {
      release()
      await done
    })
    expect(order).toEqual(['a.epub', 'c.epub'])
    expect(onEach.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]) // the cancelled one counts as dealt with
    expect(setError).toHaveBeenLastCalledWith(undefined)
    expect(result.current.queue).toEqual([])
  })

  it('cancelOne on the book being added drops only that one and goes on with the rest, with no error', async () => {
    const seen: string[] = []
    importFile.mockImplementation(
      (f: File, _p: unknown, _d: unknown, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          seen.push(f.name)
          if (f.name === 'a.epub') signal.addEventListener('abort', () => reject(signal.reason))
          else resolve({})
        }),
    )
    const { result, setError, showToast } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub'), file('b.epub')])
    })
    await vi.waitFor(() => expect(seen).toEqual(['a.epub']))
    await act(async () => {
      result.current.cancelOne(result.current.queue.find((q) => q.active)!.id)
      await done
    })
    expect(seen).toEqual(['a.epub', 'b.epub'])
    expect(setError).toHaveBeenLastCalledWith(undefined)
    expect(showToast).not.toHaveBeenCalled() // the whole queue wasn't cancelled
    expect(result.current.running).toBe(false)
  })

  it('with the background service the queue does not pause when the app is hidden, and the service stops at the end', async () => {
    service.startImportService.mockResolvedValue(true)
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    importFile.mockResolvedValue({})
    const { result } = setup()
    await act(() => result.current.addFiles([file('a.epub'), file('b.epub')]))
    expect(importFile).toHaveBeenCalledTimes(2) // not held back until the app came forward
    expect(service.startImportService).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(service.stopImportService).toHaveBeenCalledTimes(1))
    hidden.mockRestore()
  })

  it('stops the service even when the queue ends before it had started', async () => {
    let started!: (ok: boolean) => void
    service.startImportService.mockReturnValue(new Promise<boolean>((r) => (started = r)))
    const { result } = setup()
    await act(() => result.current.addFiles([file('a.epub')]))
    expect(service.stopImportService).not.toHaveBeenCalled()
    started(true)
    await vi.waitFor(() => expect(service.stopImportService).toHaveBeenCalledTimes(1))
  })

  it('without the service (browser) a hidden app pauses the queue until it is visible again', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const { result } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub')])
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(importFile).not.toHaveBeenCalled()
    hidden.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await done
    })
    expect(importFile).toHaveBeenCalledTimes(1)
    expect(service.stopImportService).not.toHaveBeenCalled()
    hidden.mockRestore()
  })

  it('shows the progress in the service notification: title with the count, the current book as text', async () => {
    service.startImportService.mockResolvedValue(true)
    vi.useFakeTimers({ toFake: ['Date'] })
    let release!: () => void
    importFile.mockImplementation(
      (f: File) => new Promise((resolve) => (f.name === 'a.epub' ? (release = () => resolve({})) : resolve({}))),
    )
    const { result } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub'), file('b.epub')])
    })
    await vi.waitFor(() => expect(service.updateImportService).toHaveBeenCalled())
    expect(service.updateImportService.mock.calls[0]).toEqual(['מוסיף ספרים לספרייה (0/2)', expect.stringContaining('a.epub'), 0, 2])
    vi.setSystemTime(Date.now() + 2000) // the notification is refreshed at most once a second
    await act(async () => {
      release()
      await done
    })
    const last = service.updateImportService.mock.calls.at(-1)!
    expect(last[0]).toMatch(/\(\d\/2\)$/)
    vi.useRealTimers()
  })

  it('does not flood the notification: many quick progress changes make one update a second', async () => {
    service.startImportService.mockResolvedValue(true)
    vi.useFakeTimers({ toFake: ['Date'] })
    importFile.mockImplementation(async (_f: File, progress: (m: string) => void) => {
      for (let i = 0; i < 20; i++) progress(`step ${i}`)
      return {}
    })
    const { result } = setup()
    await act(() => result.current.addFiles([file('a.epub'), file('b.epub')]))
    expect(service.updateImportService.mock.calls.length).toBeLessThanOrEqual(2)
    vi.useRealTimers()
  })

  it('tells in the notification that an answer about a duplicate is waited for', async () => {
    service.startImportService.mockResolvedValue(true)
    vi.useFakeTimers({ toFake: ['Date'] })
    importFile.mockImplementation(async (_f, _p, onDuplicate) => onDuplicate(existing))
    const { result } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub')])
    })
    await vi.waitFor(() => expect(result.current.dupAsk).toBeDefined())
    vi.setSystemTime(Date.now() + 2000)
    await act(async () => {
      result.current.dupAsk!.answer('skip')
      await done
    })
    vi.useRealTimers()
    expect(service.updateImportService.mock.calls.some((c) => String(c[1]).includes('ממתין לתשובה'))).toBe(true)
  })

  it('cancelling the queue also stops the service', async () => {
    service.startImportService.mockResolvedValue(true)
    importFile.mockImplementation(
      (_f: File, _p: unknown, _d: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    )
    const { result } = setup()
    let done!: Promise<void>
    act(() => {
      done = result.current.addFiles([file('a.epub'), file('b.epub')])
    })
    await vi.waitFor(() => expect(importFile).toHaveBeenCalled())
    await act(async () => {
      result.current.cancel()
      await done
    })
    await vi.waitFor(() => expect(service.stopImportService).toHaveBeenCalledTimes(1))
  })
})
