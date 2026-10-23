import { expect, test, type Page } from '@playwright/test'
import { makeEpub } from './epub.js'

test.setTimeout(90_000)

const card = (page: Page) => page.locator('.card', { hasText: 'ספר לשחזור' })

async function openBook(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'state.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() })
  await card(page).click({ timeout: 60_000 })
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
}

test('a bookmark survives a reload and is listed in the navigation panel', async ({ page }) => {
  await openBook(page)
  const position = page.getByLabel('מיקום בספר')
  const before = parseFloat(await position.inputValue())
  for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown')
  await expect.poll(async () => parseFloat(await position.inputValue())).toBeGreaterThan(before)
  await page.keyboard.press('b')
  await expect(page.getByText('נוספה סימנייה')).toBeVisible()
  await page.waitForTimeout(1500)

  await page.reload()
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'ניווט בספר' }).click()
  const nav = page.getByRole('dialog', { name: 'ניווט בספר' })
  await nav.getByRole('button', { name: 'סימניות והדגשות' }).click()
  await expect(nav.getByText('אין סימניות בספר')).toHaveCount(0)
  await expect(nav.getByRole('button', { name: /^עמוד|סימנייה/ }).first()).toBeVisible()
})

test('the book is reopened from the library at the place where it was left', async ({ page }) => {
  await openBook(page)
  const position = page.getByLabel('מיקום בספר')
  const before = parseFloat(await position.inputValue())
  for (let i = 0; i < 4; i++) await page.keyboard.press('PageDown')
  await expect.poll(async () => parseFloat(await position.inputValue())).toBeGreaterThan(before)
  const left = parseFloat(await position.inputValue())
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'חזרה לספרייה' }).click()
  await card(page).click()
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => Math.abs(parseFloat(await position.inputValue()) - left)).toBeLessThan(0.05)
})
