// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'
import type { BackupActions } from './BackupPage'

// jsdom has no layout, so every element reports offsetParent === null and Dialog would see nothing focusable
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
})

const media = (wide: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('min-width') && wide, addEventListener() {}, removeEventListener() {} }))

const actions = (): BackupActions => ({
  busy: false,
  storage: { persisted: false, usage: 5 * 1024 * 1024, quota: 1024 ** 3 },
  onPersist: vi.fn(),
  onBackup: vi.fn(),
  onRestore: vi.fn(),
  auto: { state: 'off', last: 0, onEnable: vi.fn(), onDisable: vi.fn(), onRenew: vi.fn() },
})

const renderScreen = (backup = actions(), onClose = vi.fn()) => {
  const onIdentifyLibrary = vi.fn()
  render(<SettingsScreen onClose={onClose} backup={backup} onCheckUpdate={vi.fn()} onScanDevice={vi.fn()} onIdentifyLibrary={onIdentifyLibrary} />)
  return { backup, onClose, onIdentifyLibrary }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsScreen', () => {
  it('on a narrow screen lists the pages, opens one and goes back to the list', () => {
    media(false)
    renderScreen()
    const nav = screen.getByRole('navigation', { name: 'דפי ההגדרות' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'מראה וקריאה',
      'נגישות',
      'תצוגה ומכשיר',
      'שפה ולימוד',
      'פרטיות',
      'גיבוי ואחסון',
      'יעדי קריאה',
      'אודות',
    ])
    expect(screen.queryByRole('region')).toBeNull()

    fireEvent.click(within(nav).getByText('גיבוי ואחסון'))
    expect(screen.getByRole('region', { name: 'גיבוי ואחסון' })).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'חזרה לרשימת ההגדרות' }))
    expect(screen.getByRole('navigation')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('on a wide screen shows the list next to the first page', () => {
    media(true)
    renderScreen()
    expect(screen.getByRole('navigation')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'מראה וקריאה' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'חזרה לרשימת ההגדרות' })).toBeNull()
  })

  it('closes the settings and identifies the whole library when its button is pressed', () => {
    media(true)
    const { onClose, onIdentifyLibrary } = renderScreen()
    fireEvent.click(screen.getByText('שפה ולימוד'))
    fireEvent.click(screen.getByRole('button', { name: 'זהה עכשיו' }))
    expect(onClose).toHaveBeenCalled()
    expect(onIdentifyLibrary).toHaveBeenCalled()
  })

  it('closes the settings before a backup starts, so its progress is visible', () => {
    media(true)
    const { backup, onClose } = renderScreen()
    fireEvent.click(screen.getByText('גיבוי ואחסון'))
    fireEvent.click(within(screen.getByRole('region', { name: 'גיבוי ואחסון' })).getAllByRole('button', { name: 'גיבוי' })[0]!)
    expect(onClose).toHaveBeenCalled()
    expect(backup.onBackup).toHaveBeenCalled()
  })

  it('offers persistent storage only while storage is not persistent, and shows the usage', () => {
    media(true)
    const { backup } = renderScreen()
    fireEvent.click(screen.getByText('גיבוי ואחסון'))
    expect(screen.getByText(/בשימוש 5\.0 MB/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'בקש אחסון קבוע' }))
    expect(backup.onPersist).toHaveBeenCalled()
  })

  it('saves the dictionary language to the display settings', () => {
    media(true)
    renderScreen()
    fireEvent.click(screen.getByText('שפה ולימוד'))
    fireEvent.click(screen.getByRole('button', { name: /^שפת מילון/ }))
    fireEvent.click(screen.getByRole('option', { name: 'English' }))
    expect(JSON.parse(localStorage.getItem('reader:settings') ?? '{}').dictLang).toBe('en')
  })

  it('turns on high contrast for the whole app from the accessibility page', () => {
    media(true)
    renderScreen()
    fireEvent.click(screen.getByText('נגישות'))
    fireEvent.click(screen.getByRole('checkbox', { name: /ניגודיות גבוהה/ }))
    expect(JSON.parse(localStorage.getItem('reader:settings') ?? '{}').contrast).toBe(true)
    expect(document.documentElement.classList.contains('hc')).toBe(true)
    document.documentElement.classList.remove('hc')
  })

  it('edits the layout settings of the reading look', () => {
    media(true)
    renderScreen()
    fireEvent.click(screen.getByRole('checkbox', { name: /יישור לשני הצדדים/ }))
    fireEvent.change(screen.getByRole('slider', { name: 'שוליים' }), { target: { value: '9' } })
    const saved = JSON.parse(localStorage.getItem('reader:settings') ?? '{}')
    expect(saved).toMatchObject({ justify: true, margin: 9 })
  })

  it('reopens on the page it was left on after a reload', () => {
    media(false)
    renderScreen()
    fireEvent.click(screen.getByText('אודות'))
    cleanup() // the page is reloaded: nothing closed the screen
    renderScreen()
    expect(screen.getByRole('region', { name: 'אודות' })).toBeTruthy()
  })

  it('sets the daily and yearly reading goals, within their limits', () => {
    media(true)
    renderScreen()
    fireEvent.click(screen.getByText('יעדי קריאה'))
    fireEvent.change(screen.getByRole('spinbutton', { name: /יעד יומי/ }), { target: { value: '30' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /יעד שנתי/ }), { target: { value: '99999' } })
    expect(JSON.parse(localStorage.getItem('reader:settings') ?? '{}')).toMatchObject({ dailyGoalMin: 30, yearlyGoalHours: 8760 })
  })

  it('saves the distraction-free mode where the reader reads it', () => {
    media(true)
    renderScreen()
    fireEvent.click(screen.getByText('תצוגה ומכשיר'))
    fireEvent.click(screen.getByRole('checkbox', { name: /מצב ללא הסחות/ }))
    expect(JSON.parse(localStorage.getItem('reader:viewModes') ?? '{}').focus).toBe(true)
  })

  it('searches the settings and opens the page of the one picked', () => {
    media(true)
    renderScreen()
    fireEvent.change(screen.getByRole('searchbox', { name: 'חיפוש בהגדרות' }), { target: { value: 'יעד שנתי' } })
    fireEvent.click(screen.getByRole('button', { name: /יעד שנתי/ }))
    expect(screen.getByRole('region', { name: 'יעדי קריאה' })).toBeTruthy()
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'qqqq' } })
    expect(screen.getByText('לא נמצאו הגדרות מתאימות')).toBeTruthy()
  })

  it('withdraws the permission for one external service at a time', () => {
    media(true)
    localStorage.setItem('reader:consent:translate3', '1')
    localStorage.setItem('reader:consent:dict', '1')
    renderScreen()
    fireEvent.click(screen.getByText('פרטיות'))
    fireEvent.click(screen.getByRole('button', { name: 'בטל אישור: תרגום' }))
    expect(localStorage.getItem('reader:consent:translate3')).toBeNull()
    expect(localStorage.getItem('reader:consent:dict')).toBe('1')
    expect(screen.queryByRole('button', { name: 'בטל אישור: תרגום' })).toBeNull()
    expect(screen.getByRole('button', { name: 'בטל אישור: מילון' })).toBeTruthy()
  })

  it('lists what each service receives and where it goes on the privacy page', () => {
    media(true)
    renderScreen()
    fireEvent.click(screen.getByText('פרטיות'))
    expect(screen.getByText(/המילה שסימנתם · אל: wiktionary.org/)).toBeTruthy()
    expect(screen.getAllByText(/עדיין לא אושר/)).toHaveLength(3)
  })

  it('chooses how often to be reminded to back up', () => {
    media(true)
    renderScreen()
    fireEvent.click(screen.getByText('גיבוי ואחסון'))
    fireEvent.click(screen.getByRole('button', { name: /^להזכיר לגבות/ }))
    fireEvent.click(screen.getByRole('option', { name: 'לא להזכיר' }))
    expect(JSON.parse(localStorage.getItem('reader:settings') ?? '{}').backupRemind).toBe('off')
  })

  it('closes with Escape and the close button', () => {
    media(true)
    const { onClose } = renderScreen()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'סגור הגדרות' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
