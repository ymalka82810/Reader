import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { makeEpub } from './epub.js'

const backupItem = (page: Page) => page.getByRole('menuitem', { name: 'גיבוי', exact: true })
const card = (page: Page) => page.locator('.card', { hasText: 'ספר לשחזור' })
const position = (page: Page) => page.getByLabel('מיקום בספר')
const fraction = async (page: Page) => parseFloat(await position(page).inputValue())

async function start(page: Page) {
  // force the in-memory download path for backups instead of the native save picker
  await page.addInitScript('delete window.showSaveFilePicker')
  await page.goto('/')
}

async function addBook(page: Page) {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'restore.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() })
  await expect(card(page)).toBeVisible({ timeout: 60_000 })
}

/** reads a few pages in and returns the position, once it is saved */
async function readSomePages(page: Page) {
  await card(page).click()
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  const before = await fraction(page)
  for (let i = 0; i < 4; i++) await page.keyboard.press('PageDown')
  await expect.poll(() => fraction(page)).toBeGreaterThan(before)
  const at = await fraction(page)
  await page.waitForTimeout(1500) // the progress save is debounced
  await page.reload() // the bars are hidden while reading; a reload brings them back at the saved place
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'חזרה לספרייה' }).click()
  await expect(card(page)).toBeVisible()
  return at
}

async function makeBackup(page: Page, password?: string): Promise<string> {
  await page.getByRole('button', { name: 'עוד פעולות' }).click()
  await backupItem(page).click()
  const dialog = page.getByRole('dialog', { name: 'גיבוי' })
  if (password) await dialog.getByLabel('סיסמה להצפנה (אופציונלי)').fill(password)
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'צור גיבוי' }).click()])
  return (await download.path())!
}

const restoreFrom = async (page: Page, path: string) =>
  page.locator('input[type=file][accept=".readerbackup"]').setInputFiles({
    name: 'backup.readerbackup',
    mimeType: 'application/octet-stream',
    buffer: await readFile(path),
  })

test.setTimeout(90_000)

test('a backup restored on a brand-new device brings the book back at the page being read', async ({ page, browser }) => {
  await start(page)
  await addBook(page)
  const at = await readSomePages(page)
  const backup = await makeBackup(page)

  // a second browser context is a device with nothing in it
  const context = await browser.newContext({
    baseURL: 'http://localhost:4173',
    locale: 'he-IL',
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'reader:tapHelpSeen', value: '1' }] }] },
  })
  const fresh = await context.newPage()
  await start(fresh)
  await expect(card(fresh)).toHaveCount(0)

  await restoreFrom(fresh, backup)
  await expect(fresh.getByText(/שוחזרו 1 ספרים/)).toBeVisible({ timeout: 30_000 })
  await expect(card(fresh)).toBeVisible()
  await card(fresh).click()
  await expect(fresh.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => fraction(fresh)).toBeGreaterThan(0)
  expect(Math.abs((await fraction(fresh)) - at)).toBeLessThan(0.05)
})

test('restoring the same backup again does not duplicate the book', async ({ page }) => {
  await start(page)
  await addBook(page)
  const backup = await makeBackup(page)
  await restoreFrom(page, backup)
  await expect(page.getByText(/שוחזרו 1 ספרים/)).toBeVisible({ timeout: 30_000 })
  await expect(card(page)).toHaveCount(1)
})

test('a file that is not a backup is refused and the library is untouched', async ({ page }) => {
  await start(page)
  await addBook(page)
  await page.locator('input[type=file][accept=".readerbackup"]').setInputFiles({
    name: 'junk.readerbackup',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('definitely not a backup file'),
  })
  await expect(page.getByText(/שחזור נכשל/)).toBeVisible({ timeout: 30_000 })
  await expect(card(page)).toHaveCount(1)
})

test('an encrypted backup needs its password: a wrong one is refused, the right one restores', async ({ page }) => {
  await start(page)
  await addBook(page)
  const backup = await makeBackup(page, 'סיסמה-סודית')

  // delete the book for real, then restore
  await page.getByRole('button', { name: 'פעולות לספר' }).first().click()
  await page.getByRole('menuitem', { name: 'מחק' }).click()
  await page.getByRole('alertdialog', { name: 'אישור מחיקה' }).getByRole('button', { name: 'מחק' }).click()
  await expect(card(page)).toHaveCount(0)
  await page.waitForTimeout(7500)

  await restoreFrom(page, backup)
  const ask = page.getByRole('dialog', { name: 'גיבוי מוצפן' })
  await expect(ask).toBeVisible({ timeout: 30_000 })
  await ask.getByLabel('סיסמה').fill('סיסמה-שגויה')
  await ask.getByRole('button', { name: 'שחזר' }).click()
  await expect(page.getByText(/הסיסמה שגויה/)).toBeVisible({ timeout: 30_000 })
  await expect(card(page)).toHaveCount(0)

  await ask.getByLabel('סיסמה').fill('סיסמה-סודית')
  await ask.getByRole('button', { name: 'שחזר' }).click()
  await expect(page.getByText(/שוחזרו 1 ספרים/)).toBeVisible({ timeout: 30_000 })
  await expect(card(page)).toBeVisible()
})
