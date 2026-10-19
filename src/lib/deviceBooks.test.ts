import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  consumeScanNotificationTap,
  markSeen,
  newDeviceFiles,
  normalizeFolder,
  pickNew,
  readDeviceFile,
  syncBackgroundScan,
  type DeviceFile,
} from './deviceBooks'

const file = (path: string, size = 10, modified = 1): DeviceFile => ({ path, name: path.split('/').pop()!, size, modified })

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as { Capacitor?: unknown }).Capacitor
})

describe('pickNew', () => {
  it('keeps the files never seen, sorted by path', () => {
    const seen = new Map([['/s/Documents/a.epub', '10|1']])
    const got = pickNew([file('/s/Download/c.pdf'), file('/s/Documents/a.epub'), file('/s/Documents/b.epub')], seen)
    expect(got.map((f) => f.path)).toEqual(['/s/Documents/b.epub', '/s/Download/c.pdf'])
  })

  it('looks again at a file that changed on the phone (new size or time)', () => {
    const seen = new Map([['/s/a.epub', '10|1']])
    expect(pickNew([file('/s/a.epub', 11, 1)], seen)).toHaveLength(1)
    expect(pickNew([file('/s/a.epub', 10, 2)], seen)).toHaveLength(1)
  })
})

describe('the seen list', () => {
  it('remembers what was dealt with, so the next scan skips it', async () => {
    const a = file('/s/one.epub')
    const b = file('/s/two.epub')
    expect(await newDeviceFiles([a, b])).toHaveLength(2)
    await markSeen([a])
    expect(await newDeviceFiles([a, b])).toEqual([b])
  })
})

describe('normalizeFolder', () => {
  it('drops surrounding slashes and spaces', () => {
    expect(normalizeFolder(' /Books/Hebrew/ ')).toBe('Books/Hebrew')
    expect(normalizeFolder('')).toBe('')
  })
})

describe('readDeviceFile', () => {
  it('reads through the local server with each path segment encoded, and names and types the file', async () => {
    const convertFileSrc = vi.fn((p: string) => `https://localhost/_capacitor_file_${p}`)
    ;(globalThis as { Capacitor?: unknown }).Capacitor = { nativePromise: vi.fn(), convertFileSrc }
    const fetch = vi.fn(async () => new Response('pdf'))
    vi.stubGlobal('fetch', fetch)
    const f = await readDeviceFile({ path: '/s/Download/ספר #1.pdf', name: 'ספר #1.pdf', size: 3, modified: 5 })
    expect(convertFileSrc).toHaveBeenCalledWith('/s/Download/%D7%A1%D7%A4%D7%A8%20%231.pdf')
    expect(f.name).toBe('ספר #1.pdf')
    expect(f.type).toBe('application/pdf')
    expect(f.lastModified).toBe(5)
    expect(await f.text()).toBe('pdf')
  })

  it('fails outside the app, where there is no local server', async () => {
    await expect(readDeviceFile(file('/s/a.epub'))).rejects.toThrow('no file access')
  })
})

describe('background scan', () => {
  const native = (answers: Record<string, unknown>) => {
    const nativePromise = vi.fn(async (_plugin: string, method: string, _options?: object) => answers[method])
    ;(globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, nativePromise }
    return nativePromise
  }

  it('turns the native scan on with the folders, the known books and the notification texts', async () => {
    await markSeen([file('/s/Download/known.epub', 10, 1)])
    const nativePromise = native({ status: { granted: true }, setBackground: {} })
    await syncBackgroundScan({ deviceBackgroundScan: true, deviceFolders: ['Download', 'Books'] })
    const call = nativePromise.mock.calls.find((c) => c[1] === 'setBackground')!
    expect(call[2]).toMatchObject({
      enabled: true,
      folders: ['Download', 'Books'],
      known: { '/s/Download/known.epub': '10|1' },
      title: 'נמצאו ספרים חדשים',
    })
    expect((call[2] as { textMany: string }).textMany).toContain('{n}')
  })

  it('turns it off when the setting is off or there is no file access', async () => {
    const off = native({ status: { granted: true }, setBackground: {} })
    await syncBackgroundScan({ deviceBackgroundScan: false, deviceFolders: ['Download'] })
    expect(off).toHaveBeenCalledWith('DeviceBooks', 'setBackground', { enabled: false })
    const noAccess = native({ status: { granted: false }, setBackground: {} })
    await syncBackgroundScan({ deviceBackgroundScan: true, deviceFolders: ['Download'] })
    expect(noAccess).toHaveBeenCalledWith('DeviceBooks', 'setBackground', { enabled: false })
  })

  it('does nothing outside the Android app', async () => {
    await expect(syncBackgroundScan({ deviceBackgroundScan: true, deviceFolders: [] })).resolves.toBeUndefined()
    expect(await consumeScanNotificationTap()).toBe(false)
  })

  it('reports a tap on the notification once', async () => {
    native({ consumeNotificationTap: { tapped: true } })
    expect(await consumeScanNotificationTap()).toBe(true)
  })
})
