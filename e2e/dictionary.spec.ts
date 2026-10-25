import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { gzipSync } from 'node:zlib'

/** a one-chapter Hebrew EPUB with the word the test looks up */
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
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">dict-book</dc:identifier><dc:title>ספר מילון</dc:title><dc:creator>מחבר מילון</dc:creator><dc:language>he</dc:language></metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  )
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>פרק</title></head><body><p><span id="w">האוויר</span> היה קר מאוד הבוקר.</p></body></html>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** a version 2 Hebrew pack with one word, served where the app downloads packs from */
async function servePack(page: Page) {
  const pack = [
    { v: 2, lang: 'he', shards: 1, words: 1, built: '2026-10-25T12:00Z' },
    { e: { אוויר: [{ p: 'שם עצם', g: ['תערובת גזים'], h: 'אֲוִיר', r: { s: ['אטמוספירה'] } }] }, f: {} },
  ]
    .map((l) => JSON.stringify(l) + '\n')
    .join('')
  const online: string[] = []
  await page.route('https://raw.githubusercontent.com/ymalka82810/Reader/dictionary-packs/**', (route) =>
    route.request().url().endsWith('manifest.json')
      ? route.fulfill({ json: { he: { bytes: 100, words: 1, built: '2026-10-25T12:00Z' } } })
      : route.fulfill({ body: gzipSync(pack) }),
  )
  await page.route('https://*.wiktionary.org/**', (route) => {
    online.push(route.request().url())
    return route.fulfill({ json: { query: { pages: [{ missing: true }] } } })
  })
  return online
}

for (const dictLang of ['auto', 'he']) {
  test(`a word is looked up in the dictionary on the device, not online (dictionary language: ${dictLang})`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem('reader:settings', JSON.stringify({ dictLang: l })), dictLang)
    const online = await servePack(page)
    page.on('console', (m) => m.type() === 'error' && console.log('browser:', m.text()))
    page.on('pageerror', (e) => console.log('page error:', e.message))
    await page.goto('/')

    // download the Hebrew dictionary from the settings
    await page.getByRole('button', { name: 'הגדרות' }).first().click()
    await page.getByRole('button', { name: /שפה/ }).first().click()
    await page.getByRole('button', { name: /הורדה.*עברית/ }).click()
    await expect(page.getByRole('button', { name: /מחק.*עברית/ })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await page.goto('/')

    await page.locator('input[type=file]').first().setInputFiles({ name: 'dict.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() })
    await page.locator('.card', { hasText: 'ספר מילון' }).click({ timeout: 30_000 })
    const frame = async () => {
      await expect.poll(() => page.frames().some((f) => f.url().startsWith('blob:')), { timeout: 30_000 }).toBe(true)
      return page.frames().find((f) => f.url().startsWith('blob:'))!
    }
    const book = await frame()
    await expect.poll(() => book.evaluate<boolean>(`!!document.getElementById('w')`), { timeout: 30_000 }).toBe(true)
    await book.evaluate(`(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('w'))
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })()`)

    await page.getByRole('button', { name: 'חפש במילון' }).click()
    await expect(page.getByText(/תערובת גזים/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('לשלוח טקסט לשרת חיצוני?')).toHaveCount(0)
    expect(online).toEqual([])
  })
}
