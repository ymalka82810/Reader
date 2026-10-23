import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'

/** a one-chapter EPUB, built on the fly so no binary fixture is needed */
async function makeEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">a11y-book</dc:identifier><dc:title>ספר בדיקה</dc:title><dc:creator>מחבר בדיקה</dc:creator><dc:language>he</dc:language></metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  )
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>פרק 1</title></head><body><h1>פרק 1</h1><p>${'זהו משפט בדיקה. '.repeat(40)}</p></body></html>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** the rule ids and the first offending element of each violation, so a failure says what to fix */
async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}x, e.g. ${v.nodes[0]?.target.join(' ')}`)
}

for (const scheme of ['light', 'dark'] as const) {
test(`the library and every settings page have no axe violations (${scheme})`, async ({ page }) => {
  // transitions would be sampled half-way, with colours that are not the final ones
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() })
  await expect(page.locator('.card', { hasText: 'ספר בדיקה' })).toBeVisible({ timeout: 30_000 })
  expect(await violations(page), 'library').toEqual([])

  await page.getByRole('button', { name: 'הגדרות', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'הגדרות', exact: true })
  await expect(dialog).toBeVisible()
  const pages = dialog.getByRole('navigation').getByRole('button')
  const count = await pages.count()
  expect(count).toBeGreaterThan(5)
  for (let i = 0; i < count; i++) {
    const name = (await pages.nth(i).textContent()) ?? String(i)
    await pages.nth(i).click()
    expect(await violations(page), `settings: ${name}`).toEqual([])
  }
})
}

test('the reader, with its panels open, has no axe violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() })
  await page.locator('.card', { hasText: 'ספר בדיקה' }).click({ timeout: 30_000 })
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
  expect(await violations(page), 'reader').toEqual([])

  // the table of contents is one of the panels over the book
  await page.keyboard.press('t')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await violations(page), 'table of contents').toEqual([])
})
