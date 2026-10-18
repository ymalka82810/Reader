import { beforeEach, describe, expect, it } from 'vitest'
import { backupDue } from './backupReminder'
import type { BackupRemind } from './settings'

const DAY = 24 * 3600 * 1000

/** the last backup was `days` ago, and the user chose `remind` in the settings */
const setup = (days: number, remind?: BackupRemind) => {
  localStorage.clear()
  localStorage.setItem('reader:lastBackup', String(Date.now() - days * DAY))
  if (remind) localStorage.setItem('reader:settings', JSON.stringify({ backupRemind: remind }))
}

describe('backupDue', () => {
  beforeEach(() => localStorage.clear())

  it('asks after two weeks by default', () => {
    setup(10)
    expect(backupDue()).toBe(false)
    setup(15)
    expect(backupDue()).toBe(true)
  })

  it('follows the chosen interval', () => {
    setup(10, 'week')
    expect(backupDue()).toBe(true)
    setup(10, 'month')
    expect(backupDue()).toBe(false)
    setup(31, 'month')
    expect(backupDue()).toBe(true)
  })

  it('asks after three days when storage may be cleared, or sooner with a shorter interval', () => {
    setup(4)
    expect(backupDue(true)).toBe(true)
    setup(2, 'month')
    expect(backupDue(true)).toBe(false)
    setup(4, 'month')
    expect(backupDue(true)).toBe(true)
  })

  it('never asks when switched off, even for storage that may be cleared', () => {
    setup(400, 'off')
    expect(backupDue()).toBe(false)
    expect(backupDue(true)).toBe(false)
  })
})
