import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** a one-page PDF with a text layer, assembled by hand so no binary fixture is needed */
function makePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

const addFile = (page: Page, name: string, mimeType: string, buffer: Buffer) =>
  page.locator('input[type=file]').first().setInputFiles({ name, mimeType, buffer })

/** books without an author are grouped in the "no author" folder */
async function openNoAuthorFolder(page: Page) {
  const folder = page.getByRole('button', { name: /תיקייה ללא מחבר/ })
  await expect(folder).toBeVisible({ timeout: 60_000 })
  await folder.click()
}

/** "גיבוי" alone, not "גיבוי אוטומטי לתיקייה…" */
const backupItem = (page: Page) => page.getByRole('menuitem', { name: 'גיבוי', exact: true })

test.beforeEach(async ({ page }) => {
  // force the in-memory download path for backups instead of the native save picker
  await page.addInitScript('delete window.showSaveFilePicker')
  await page.goto('/')
})

test('import a PDF', async ({ page }) => {
  await addFile(page, 'pdf-test.pdf', 'application/pdf', makePdf('Hello PDF world, a page with a real text layer'))
  await openNoAuthorFolder(page)
  await expect(page.getByRole('button', { name: /pdf-test/ })).toBeVisible({ timeout: 60_000 })
})

test('delete a book, with undo', async ({ page }) => {
  await addFile(page, 'delete-me.txt', 'text/plain', Buffer.from('שלום עולם. '.repeat(50)))
  await openNoAuthorFolder(page)
  const card = page.getByRole('button', { name: /delete-me/ })
  await expect(card).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'פעולות לספר' }).first().click()
  await page.getByRole('menuitem', { name: 'מחק' }).click()
  await page.getByRole('alertdialog', { name: 'אישור מחיקה' }).getByRole('button', { name: 'מחק' }).click()
  await expect(card).toHaveCount(0)

  // undo brings it back (the emptied folder closed, so open it again)
  await page.getByRole('button', { name: 'בטל' }).click()
  await openNoAuthorFolder(page)
  await expect(card).toBeVisible()

  // delete again and let it become final
  await page.getByRole('button', { name: 'פעולות לספר' }).first().click()
  await page.getByRole('menuitem', { name: 'מחק' }).click()
  await page.getByRole('alertdialog', { name: 'אישור מחיקה' }).getByRole('button', { name: 'מחק' }).click()
  await expect(card).toHaveCount(0)
  await page.waitForTimeout(7500)
  await page.reload()
  await expect(page.getByRole('button', { name: /delete-me/ })).toHaveCount(0)
})

test('back up the library, delete the book, restore it', async ({ page }) => {
  await addFile(page, 'backup-me.txt', 'text/plain', Buffer.from('טקסט לגיבוי. '.repeat(50)))
  await openNoAuthorFolder(page)
  const card = page.getByRole('button', { name: /backup-me/ })
  await expect(card).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'עוד פעולות' }).click()
  await backupItem(page).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('dialog', { name: 'גיבוי' }).getByRole('button', { name: 'צור גיבוי' }).click(),
  ])
  const path = await download.path()

  await page.getByRole('button', { name: 'פעולות לספר' }).first().click()
  await page.getByRole('menuitem', { name: 'מחק' }).click()
  await page.getByRole('alertdialog', { name: 'אישור מחיקה' }).getByRole('button', { name: 'מחק' }).click()
  await expect(card).toHaveCount(0)
  await page.waitForTimeout(7500)

  await page.locator('input[type=file][accept=".readerbackup"]').setInputFiles({
    name: 'backup.readerbackup',
    mimeType: 'application/octet-stream',
    buffer: await readFile(path),
  })
  await expect(page.getByText(/שוחזרו 1 ספרים/)).toBeVisible({ timeout: 30_000 })
  await openNoAuthorFolder(page)
  await expect(page.getByRole('button', { name: /backup-me/ })).toBeVisible()
})

test('dialog keeps focus inside and returns it on close', async ({ page }) => {
  await page.getByRole('button', { name: 'עוד פעולות' }).click()
  await backupItem(page).click()
  const dialog = page.getByRole('dialog', { name: 'גיבוי' })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    await expect(dialog.locator(':focus')).toHaveCount(1)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
