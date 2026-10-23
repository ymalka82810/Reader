import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** a .docx with a title and a few paragraphs, assembled by hand */
async function makeDocx(title: string, paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  const p = (text: string, style = '') =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${p(title, 'Heading1')}${paragraphs.map((t) => p(t)).join('')}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

const addFiles = (page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) =>
  page.locator('input[type=file]').first().setInputFiles(files)

const txt = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })
const body = (word: string) => `${word} `.repeat(300)

test.setTimeout(60_000)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('a text file is added, opens in the reader and shows its text', async ({ page }) => {
  await addFiles(page, [txt('סיפור-קצר.txt', 'פעם אחת היה ספר קצר מאוד. ' + body('מילה'))])
  const card = page.locator('.card', { hasText: 'סיפור-קצר' })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(page.locator('foliate-view')).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(
      () =>
        page.evaluate<string>(
          `(document.querySelector('foliate-view')?.renderer?.getContents?.() ?? []).map((c) => c.doc.body?.textContent ?? '').join('')`,
        ),
      { timeout: 30_000 },
    )
    .toContain('פעם אחת היה ספר קצר מאוד')
})

test('a DOCX is converted, added and opens', async ({ page }) => {
  await addFiles(page, [
    { name: 'מסמך-וורד.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await makeDocx('פרק ראשון', ['שלום מוורד ' + body('טקסט')]) },
  ])
  const card = page.locator('.card', { hasText: 'מסמך-וורד' })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(page.locator('foliate-view')).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(
      () =>
        page.evaluate<string>(
          `(document.querySelector('foliate-view')?.renderer?.getContents?.() ?? []).map((c) => c.doc.body?.textContent ?? '').join('')`,
        ),
      { timeout: 30_000 },
    )
    .toContain('שלום מוורד')
})

test('several files at once are all added', async ({ page }) => {
  await addFiles(page, [txt('ראשון.txt', body('אלף')), txt('שני.txt', body('בית')), txt('שלישי.txt', body('גימל'))])
  for (const name of ['ראשון', 'שני', 'שלישי']) {
    await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible({ timeout: 60_000 })
  }
})

test('a file of an unsupported type is refused with a message and nothing is added', async ({ page }) => {
  await addFiles(page, [{ name: 'תמונה.xyz', mimeType: 'application/octet-stream', buffer: Buffer.from('not a book') }])
  await expect(page.getByText(/סוג הקובץ לא נתמך/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /תמונה/ })).toHaveCount(0)
})

test('an empty file is refused', async ({ page }) => {
  await addFiles(page, [txt('ריק.txt', '')])
  await expect(page.getByText('הקובץ ריק.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /ריק/ })).toHaveCount(0)
})

test('a broken EPUB is refused and the library stays usable', async ({ page }) => {
  await addFiles(page, [{ name: 'שבור.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('this is not a zip archive') }])
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /שבור/ })).toHaveCount(0)
  // a good book still goes in afterwards
  await addFiles(page, [txt('תקין.txt', body('שלום'))])
  await expect(page.getByRole('button', { name: /תקין/ }).first()).toBeVisible({ timeout: 60_000 })
})

test('the very same file added again is not added twice', async ({ page }) => {
  const file = txt('כפול.txt', body('זהה'))
  await addFiles(page, [file])
  const card = page.getByRole('button', { name: /כפול/ })
  await expect(card.first()).toBeVisible({ timeout: 60_000 })
  // let the import and the background identify settle, or the second add can land while the first is still being finished
  await page.waitForTimeout(2000)
  await addFiles(page, [file])
  // refused, whether it is reported or skipped silently: nothing is added and no question is asked
  await page.waitForTimeout(2000)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(card).toHaveCount(1)
})

/** a book is in the library, and a different file with the same title is added: the app asks what to do */
async function addSameTitleDifferentFile(page: Page) {
  await addFiles(page, [txt('ספר עם שם ארוך מספיק.txt', body('גרסה ראשונה'))])
  const card = page.getByRole('button', { name: /ספר עם שם ארוך מספיק/ })
  await expect(card.first()).toBeVisible({ timeout: 60_000 })
  // let the import and the background identify settle, or the second add can land while the first is still being finished
  await page.waitForTimeout(2000)
  await addFiles(page, [txt('ספר עם שם ארוך מספיק.txt', body('גרסה שנייה, אחרת לגמרי'))])
  const dialog = page.getByRole('alertdialog', { name: 'הספר כבר קיים' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  return { card, dialog }
}

test('a different file with the same title asks what to do; skipping keeps one copy', async ({ page }) => {
  const { card, dialog } = await addSameTitleDifferentFile(page)
  await dialog.getByRole('button', { name: 'דלג', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(1000)
  await expect(card).toHaveCount(1)
})

test('a different file with the same title: add anyway keeps both', async ({ page }) => {
  const { card, dialog } = await addSameTitleDifferentFile(page)
  await dialog.getByRole('button', { name: 'הוסף בכל זאת' }).click()
  await expect(card).toHaveCount(2, { timeout: 30_000 })
})
