import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'

/** a small but multi-page EPUB, built on the fly so no binary fixture is needed */
async function makeEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  const chapters = [1, 2, 3, 4]
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">e2e-book</dc:identifier><dc:title>ספר בדיקה</dc:title><dc:creator>מחבר בדיקה</dc:creator><dc:language>he</dc:language></metadata>
<manifest>${chapters.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${chapters.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`,
  )
  const para = 'זהו משפט ארוך למדי שנועד למלא את העמוד בטקסט כדי שיהיו הרבה עמודים בספר הבדיקה. '.repeat(12)
  for (const n of chapters) {
    zip.file(
      `OEBPS/c${n}.xhtml`,
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>פרק ${n}</title></head><body><h1>פרק ${n}</h1>${Array.from({ length: 40 }, () => `<p>${para}</p>`).join('')}</body></html>`,
    )
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** the imported book sits in its author's folder, which opens by itself */
async function openBook(page: Page) {
  await page.locator('.card', { hasText: 'ספר בדיקה' }).click({ timeout: 30_000 })
}

test('import an EPUB, open it, turn a page, reload and keep the position', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'test.epub',
    mimeType: 'application/epub+zip',
    buffer: await makeEpub(),
  })

  await openBook(page)

  const position = page.getByLabel('מיקום בספר')
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  const readFraction = async () => parseFloat(await position.inputValue())

  const before = await readFraction()
  for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown')
  await expect.poll(readFraction).toBeGreaterThan(before)
  const turned = await readFraction()

  // give the debounced progress save time to land before reloading
  await page.waitForTimeout(1500)
  await page.reload()

  // the app reopens the book that was open, at the saved position
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(readFraction).toBeGreaterThan(before)
  expect(Math.abs((await readFraction()) - turned)).toBeLessThan(0.05)

  // and the library card shows the saved progress
  await page.getByRole('button', { name: 'חזרה לספרייה' }).click()
  await expect(page.locator('.card', { hasText: 'ספר בדיקה' }).getByRole('progressbar')).toBeVisible()
})

for (const flow of ['paginated', 'scrolled'] as const) {
  test(`auto-reading moves the text by itself (${flow})`, async ({ page }) => {
    // the fastest stored pace, so the test doesn't wait for a real reader's page time
    await page.addInitScript((f) => {
      localStorage.setItem('reader:pace', '1')
      localStorage.setItem('reader:settings', JSON.stringify({ flow: f, pageTransition: false }))
    }, flow)
    await page.goto('/')
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'test.epub',
      mimeType: 'application/epub+zip',
      buffer: await makeEpub(),
    })
    await openBook(page)
    await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })

    const position = page.getByLabel('מיקום בספר')
    const readFraction = async () => parseFloat(await position.inputValue())
    const before = await readFraction()

    await page.getByRole('button', { name: 'קריאה אוטומטית' }).click()
    await expect.poll(readFraction, { timeout: 15_000 }).toBeGreaterThan(before)

    // the shortcut stops it again
    await page.keyboard.press('a')
    await expect(page.getByRole('button', { name: 'קריאה אוטומטית' })).toBeVisible()
  })
}

test('the back gesture leaves the book only when repeated', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'test.epub',
    mimeType: 'application/epub+zip',
    buffer: await makeEpub(),
  })
  await openBook(page)
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })

  await page.goBack()
  await expect(page.getByText('החלקה נוספת תחזיר לספרייה')).toBeVisible()
  await expect(page.getByText(/^עמוד/)).toBeVisible()

  await page.goBack()
  await expect(page.locator('.card', { hasText: 'ספר בדיקה' })).toBeVisible()
})

test('scripts inside an EPUB do not run', async ({ page }) => {
  const zip = await JSZip.loadAsync(await makeEpub())
  const ch = await zip.file('OEBPS/c1.xhtml')!.async('string')
  zip.file(
    'OEBPS/c1.xhtml',
    ch.replace('</body>', `<script>window.parent.__epubScriptRan = true</script><img src="x.png" onerror="window.parent.__epubScriptRan = true"/></body>`),
  )
  const logs: string[] = []
  page.on('console', (m) => logs.push(m.text()))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'test.epub',
    mimeType: 'application/epub+zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  })
  await openBook(page)
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(500)
  expect(await page.evaluate('window.__epubScriptRan')).toBeUndefined()
  expect(logs.some((l) => /Content Security Policy/i.test(l))).toBe(true)
})
