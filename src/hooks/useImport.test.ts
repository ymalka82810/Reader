// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMeta } from '../lib/db'

const importFile = vi.hoisted(() => vi.fn())
const takeSharedFiles = vi.hoisted(() => vi.fn())
const onLaunchFiles = vi.hoisted(() => vi.fn())
vi.mock('../lib/importBook', async (orig) => ({ ...(await orig<object>()), importFile }))
vi.mock('../lib/inbox', () => ({ takeSharedFiles, onLaunchFiles }))

const { useImport } = await import('./useImport')
const { DeferredDuplicate } = await import('../lib/importBook')

const file = (name: string) => new File(['x'], name)
const existing = { id: 'old', title: 'Old' } as BookMeta

function setup() {
  const deps = { refresh: vi.fn(async () => {}), setBusy: vi.fn(), setError: vi.fn() }
  const hook = renderHook(() => useImport(deps))
  return { ...hook, ...deps }
}

beforeEach(() => {
  importFile.mockReset()
  importFile.mockResolvedValue({})
  takeSharedFiles.mockReset()
  takeSharedFiles.mockResolvedValue([])
  onLaunchFiles.mockReset()
})

describe('useImport', () => {
  it('imports each file, refreshing after every one, and clears the busy state', async () => {
    const { result, refresh, setBusy, setError } = setup()
    await act(() => result.current.addFiles([file('a.epub'), file('b.epub')]))
    expect(importFile).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(3) // once per file and a final one
    expect(setBusy).toHaveBeenLastCalledWith(undefined)
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
})
