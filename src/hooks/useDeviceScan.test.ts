// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceFile } from '../lib/deviceBooks'

const lib = vi.hoisted(() => ({
  deviceBooksSupported: vi.fn(() => true),
  hasDeviceAccess: vi.fn(async () => true),
  requestDeviceAccess: vi.fn(async () => true),
  scanDevice: vi.fn(async (): Promise<DeviceFile[]> => []),
  newDeviceFiles: vi.fn(async (f: DeviceFile[]) => f),
  markSeen: vi.fn(async () => {}),
  readDeviceFile: vi.fn(async (f: DeviceFile) => new File(['x'], f.name)),
}))
vi.mock('../lib/deviceBooks', () => lib)

const { useDeviceScan } = await import('./useDeviceScan')

const found = (name: string): DeviceFile => ({ path: `/s/Download/${name}`, name, size: 1, modified: 1 })

function setup(confirmed = true) {
  const deps = {
    addFiles: vi.fn(async (files: { name: string; load: () => Promise<File> }[], opts: { onEach?: (i: number) => void }) => {
      for (const [i, f] of files.entries()) {
        await f.load()
        opts.onEach?.(i)
      }
    }),
    setBusy: vi.fn(),
    setError: vi.fn(),
    showToast: vi.fn(),
    confirm: vi.fn(async () => confirmed),
  }
  const hook = renderHook(() => useDeviceScan(deps))
  return { ...hook, ...deps }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  lib.deviceBooksSupported.mockReturnValue(true)
  lib.hasDeviceAccess.mockResolvedValue(true)
  lib.scanDevice.mockResolvedValue([])
})

describe('useDeviceScan', () => {
  it('scans the default folders when the app opens and adds the new books without asking', async () => {
    vi.setSystemTime(Date.now() + 120_000) // past the once-a-minute limit of an earlier test
    localStorage.setItem('reader:deviceOffered', '1')
    lib.scanDevice.mockResolvedValue([found('a.epub'), found('b.pdf')])
    const { addFiles, confirm, showToast } = setup()
    await vi.waitFor(() => expect(addFiles).toHaveBeenCalled())
    expect(lib.scanDevice).toHaveBeenCalledWith(['Documents', 'Download'])
    expect(confirm).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalled()
    expect(addFiles.mock.calls[0]![1]).toMatchObject({ skipDuplicates: true })
    await vi.waitFor(() => expect(lib.markSeen).toHaveBeenCalledTimes(2))
    vi.useRealTimers()
  })

  it('offers access once on open, and stays quiet after that', async () => {
    vi.setSystemTime(Date.now() + 200_000)
    lib.hasDeviceAccess.mockResolvedValue(false)
    const first = setup(false)
    await vi.waitFor(() => expect(first.confirm).toHaveBeenCalledTimes(1))
    expect(lib.requestDeviceAccess).not.toHaveBeenCalled()
    first.unmount()
    vi.clearAllMocks()
    lib.hasDeviceAccess.mockResolvedValue(false)
    vi.setSystemTime(Date.now() + 240_000)
    localStorage.setItem('reader:deviceOffered', '1')
    const { confirm, setError } = setup()
    await vi.waitFor(() => expect(lib.hasDeviceAccess).toHaveBeenCalled())
    expect(confirm).not.toHaveBeenCalled()
    expect(lib.scanDevice).not.toHaveBeenCalled()
    expect(setError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not scan on open when the automatic scan is off', async () => {
    vi.setSystemTime(Date.now() + 360_000)
    localStorage.setItem('reader:settings', JSON.stringify({ deviceAutoScan: false }))
    setup()
    await new Promise((r) => setTimeout(r, 10))
    expect(lib.hasDeviceAccess).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('a manual scan asks for access first, then asks before adding what it found', async () => {
    localStorage.setItem('reader:settings', JSON.stringify({ deviceAutoScan: false, deviceFolders: ['Books'] }))
    lib.hasDeviceAccess.mockResolvedValue(false)
    lib.scanDevice.mockResolvedValue([found('a.epub')])
    const { result, confirm, addFiles } = setup()
    await act(() => result.current())
    expect(lib.requestDeviceAccess).toHaveBeenCalled()
    expect(lib.scanDevice).toHaveBeenCalledWith(['Books'])
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(addFiles).toHaveBeenCalled()
  })

  it('a manual scan with nothing new says so', async () => {
    localStorage.setItem('reader:settings', JSON.stringify({ deviceAutoScan: false }))
    const { result, showToast, addFiles } = setup()
    await act(() => result.current())
    expect(addFiles).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('לא נמצאו ספרים חדשים בטלפון.', undefined, 4000)
  })

  it('reports a manual scan that fails, and when access is refused', async () => {
    localStorage.setItem('reader:settings', JSON.stringify({ deviceAutoScan: false }))
    lib.scanDevice.mockRejectedValueOnce(new Error('scan'))
    const { result, setError } = setup()
    await act(() => result.current())
    expect(setError).toHaveBeenLastCalledWith('הסריקה נכשלה: scan')
    lib.hasDeviceAccess.mockResolvedValue(false)
    lib.requestDeviceAccess.mockResolvedValueOnce(false)
    await act(() => result.current())
    expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('אין גישה'))
  })
})
