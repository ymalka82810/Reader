import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

// The script of this book tries everything a hostile book could: reading the reader's page, its storage and
// library, the network, and navigating away. Whatever it learns is written into the page, where the test reads it.
const PROBE = `
const out = []
const attempt = (name, fn) => { try { out.push(name + ':' + fn()) } catch (e) { out.push(name + ':blocked') } }
attempt('parent', () => typeof parent.document.title)
attempt('storage', () => typeof localStorage.length)
attempt('idb', () => typeof indexedDB.open('keyval-store'))
attempt('cookie', () => document.cookie.length)
fetch('https://example.com/').then(() => out.push('fetch:open'), () => out.push('fetch:blocked'))
  .finally(() => { document.getElementById('out').textContent = out.join('|') })
document.getElementById('hello').textContent = 'script ran'
`

async function makeScriptedEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">scripted</dc:identifier><dc:title>ספר סקריפט</dc:title><dc:language>he</dc:language></metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml" properties="scripted"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="js" href="probe.js" media-type="text/javascript"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  )
  zip.file('OEBPS/probe.js', PROBE)
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><h1>פרק 1</h1><p id="hello"></p><p id="out"></p><a href="c2.xhtml">לפרק הבא</a><script src="probe.js"/></body></html>`,
  )
  zip.file('OEBPS/c2.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>2</title></head><body><h1>פרק 2</h1></body></html>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('a scripted EPUB runs in an isolated sandbox that cannot reach the reader', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'scripted.epub',
    mimeType: 'application/epub+zip',
    buffer: await makeScriptedEpub(),
  })
  await page.locator('.card', { hasText: 'ספר סקריפט' }).click({ timeout: 30_000 })

  const iframe = page.locator('iframe.interactive-frame')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  const book = page.frameLocator('iframe.interactive-frame')
  await expect(book.locator('#hello')).toHaveText('script ran', { timeout: 30_000 })
  await expect(book.locator('#out')).toContainText('fetch:blocked')
  const report = await book.locator('#out').textContent()
  for (const probe of ['parent', 'storage', 'idb', 'cookie']) expect(report).toContain(`${probe}:blocked`)

  // a link inside the book moves to the next chapter through the reader
  await book.getByText('לפרק הבא').click()
  await expect(book.locator('h1')).toHaveText('פרק 2', { timeout: 30_000 })

  // the same book opens as a regular one (scripts stay off there)
  await page.getByRole('button', { name: /פתיחה כספר רגיל/ }).click()
  await expect(page.getByRole('region', { name: /תוכן הספר/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('iframe.interactive-frame')).toHaveCount(0)
})
