// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  hasDeviceAccess: vi.fn(async () => true),
  requestDeviceAccess: vi.fn(async () => true),
  requestNotificationAccess: vi.fn(async () => true),
  syncBackgroundScan: vi.fn(async () => {}),
  pickDeviceFolder: vi.fn(async () => undefined),
  normalizeFolder: (f: string) => f.trim().replace(/^\/+|\/+$/g, ''),
}))
vi.mock('../../lib/deviceBooks', () => lib)

const { DevicePage } = await import('./DevicePage')
const { loadSettings } = await import('../../lib/settings')

const toggle = () => screen.getByRole('checkbox', { name: /סריקה ברקע/ }) as HTMLInputElement

function renderPage(over: Partial<ReturnType<typeof loadSettings>> = {}) {
  const set = vi.fn()
  const settings = { ...loadSettings(), ...over }
  render(<DevicePage settings={settings} set={set} busy={false} onScan={vi.fn()} />)
  return { set, settings }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  lib.requestNotificationAccess.mockResolvedValue(true)
})
afterEach(cleanup)

describe('DevicePage: scan in the background', () => {
  it('is on by default and has its own switch next to the automatic scan', () => {
    renderPage()
    expect(toggle().checked).toBe(true)
    expect(screen.getByText(/גם כשהאפליקציה סגורה או לא על המסך/)).toBeTruthy()
  })

  it('turning it on saves the setting, asks for the notification permission and tells the native side', async () => {
    const { set, settings } = renderPage({ deviceBackgroundScan: false })
    fireEvent.click(toggle())
    expect(set).toHaveBeenCalledWith('deviceBackgroundScan', true)
    await waitFor(() => expect(lib.syncBackgroundScan).toHaveBeenCalledTimes(1))
    expect(lib.requestNotificationAccess).toHaveBeenCalledTimes(1)
    expect(lib.syncBackgroundScan).toHaveBeenCalledWith({ deviceBackgroundScan: true, deviceFolders: settings.deviceFolders })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so when the notifications stay off, but still turns the scan on', async () => {
    lib.requestNotificationAccess.mockResolvedValue(false)
    const { set } = renderPage({ deviceBackgroundScan: false })
    fireEvent.click(toggle())
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('ההתראות של האפליקציה כבויות'))
    expect(set).toHaveBeenCalledWith('deviceBackgroundScan', true)
    expect(lib.syncBackgroundScan).toHaveBeenCalledWith(expect.objectContaining({ deviceBackgroundScan: true }))
  })

  it('turning it off does not ask for anything and switches the native scan off', async () => {
    const { set } = renderPage({ deviceBackgroundScan: true })
    fireEvent.click(toggle())
    expect(set).toHaveBeenCalledWith('deviceBackgroundScan', false)
    await waitFor(() => expect(lib.syncBackgroundScan).toHaveBeenCalledWith(expect.objectContaining({ deviceBackgroundScan: false })))
    expect(lib.requestNotificationAccess).not.toHaveBeenCalled()
  })

  it('forgets an earlier notification warning when the switch is used again', async () => {
    lib.requestNotificationAccess.mockResolvedValueOnce(false)
    renderPage({ deviceBackgroundScan: false })
    fireEvent.click(toggle())
    await screen.findByRole('alert')
    fireEvent.click(toggle())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
