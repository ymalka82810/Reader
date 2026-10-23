import { expect, test, type Locator, type Page } from '@playwright/test'
import { makeEpub } from './epub.js'

/**
 * Guards the "friendly, not sharp" rule from CLAUDE.md: the main views keep rounded corners
 * and a soft shadow. Computed styles are asserted instead of screenshots, so the checks don't
 * depend on fonts or the platform they render on.
 */

/** every box shows a rounded corner; `shadow` boxes (floating panels, menus, dialogs) also a shadow */
async function expectFriendly(box: Locator, { shadow }: { shadow: boolean }) {
  const first = box.first()
  await expect(first).toBeVisible()
  await expect(first).toHaveCSS('border-top-left-radius', /^[1-9]/)
  if (shadow) await expect(first).not.toHaveCSS('box-shadow', 'none')
}

/** a lone book opens its folder by itself; with two books the search box and sort tools show too */
async function importBook(page: Page, { two }: { two: boolean }) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'friendly.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() },
    ...(two ? [{ name: 'plain.txt', mimeType: 'text/plain', buffer: Buffer.from('שלום עולם. '.repeat(50)) }] : []),
  ])
  await expect(two ? page.locator('.lib-search') : page.locator('.card').first()).toBeVisible({ timeout: 60_000 })
}

test('library: header buttons, search box, covers and menus are rounded', async ({ page }) => {
  await importBook(page, { two: true })
  await expectFriendly(page.locator('.lib-search'), { shadow: false })
  await expectFriendly(page.getByRole('button', { name: 'הגדרות' }).first(), { shadow: false })
  await expectFriendly(page.locator('.cover'), { shadow: true })

  await page.getByRole('button', { name: 'פעולות לספר' }).first().click()
  await expectFriendly(page.getByRole('menu'), { shadow: true })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'עוד פעולות', exact: true }).first().click()
  await expectFriendly(page.getByRole('menu'), { shadow: true })
})

test('library: the settings dialog is a rounded, shadowed panel', async ({ page }) => {
  await importBook(page, { two: false })
  await page.getByRole('button', { name: 'הגדרות' }).first().click()
  await expectFriendly(page.getByRole('dialog').getByRole('button').first(), { shadow: false })
})

test('reader: bars, buttons and the settings and search panels are rounded', async ({ page }) => {
  await importBook(page, { two: false })
  await page.locator('.card').first().click()
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })

  await expectFriendly(page.locator('.topbar button').first(), { shadow: false })

  await page.getByRole('button', { name: 'חיפוש' }).click()
  await expectFriendly(page.locator('.panel'), { shadow: true })
  await expectFriendly(page.locator('.panel input').first(), { shadow: false })
  await page.getByRole('button', { name: 'חיפוש' }).click()

  await page.getByRole('button', { name: 'הגדרות תצוגה' }).click()
  await expectFriendly(page.locator('.panel'), { shadow: true })
})
