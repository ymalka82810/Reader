// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { applyAppTheme, loadAppTheme, saveAppTheme } from './appTheme'

afterEach(() => saveAppTheme('auto'))

test('defaults to auto and remembers a forced scheme', () => {
  expect(loadAppTheme()).toBe('auto')
  saveAppTheme('dark')
  expect(loadAppTheme()).toBe('dark')
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
})

test('auto removes the override', () => {
  applyAppTheme('light')
  applyAppTheme('auto')
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
})
