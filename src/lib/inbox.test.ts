// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { takeSharedFiles } from './inbox'

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor
  vi.unstubAllGlobals()
})

describe('takeSharedFiles (Android "open with")', () => {
  it('returns nothing outside the Android app', async () => {
    expect(await takeSharedFiles()).toEqual([])
  })

  it('reads the files the app was opened with through the local server', async () => {
    const nativePromise = vi.fn().mockResolvedValue({ files: [{ path: '/data/cache/open-with/1-ספר #1.epub', name: 'ספר #1.epub' }] })
    const convertFileSrc = vi.fn((p: string) => `https://localhost/_capacitor_file_${p}`)
    ;(globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, nativePromise, convertFileSrc }
    const fetchMock = vi.fn().mockResolvedValue(new Response('epub bytes'))
    vi.stubGlobal('fetch', fetchMock)

    const files = await takeSharedFiles()

    expect(nativePromise).toHaveBeenCalledWith('OpenWith', 'takePending')
    expect(String(fetchMock.mock.calls[0]![0])).toContain(encodeURIComponent('1-ספר #1.epub'))
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('ספר #1.epub')
    expect(files[0]!.type).toBe('application/epub+zip')
  })

  it('skips a file that cannot be read and keeps the others', async () => {
    const nativePromise = vi.fn().mockResolvedValue({
      files: [
        { path: '/c/a.pdf', name: 'a.pdf' },
        { path: '/c/b.pdf', name: 'b.pdf' },
      ],
    })
    ;(globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      nativePromise,
      convertFileSrc: (p: string) => `https://localhost${p}`,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('ok')),
    )
    const files = await takeSharedFiles()
    expect(files.map((f) => f.name)).toEqual(['b.pdf'])
  })

  it('returns nothing when the native call fails', async () => {
    ;(globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      nativePromise: vi.fn().mockRejectedValue(new Error('boom')),
    }
    expect(await takeSharedFiles()).toEqual([])
  })
})
