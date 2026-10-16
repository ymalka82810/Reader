import { devices, expect, test } from '@playwright/test'
import JSZip from 'jszip'

// a phone with a touchscreen, like the Android app
test.use({ ...devices['Pixel 7'] })

/** a Hebrew EPUB with a table of contents and no page-progression-direction, like many real ones */
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
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">e2e-touch</dc:identifier><dc:title>ספר מגע</dc:title><dc:creator>מחבר מגע</dc:creator><dc:language>he</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${chapters.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`,
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>תוכן</title></head><body><nav epub:type="toc"><ol>${chapters.map((n) => `<li><a href="c${n}.xhtml">פרק ${n}</a></li>`).join('')}</ol></nav></body></html>`,
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

for (const flow of ['scrolled', 'paginated'] as const) {
  test(`edge taps turn pages and the table of contents still works (${flow})`, async ({ page }) => {
    await page.addInitScript((f) => {
      localStorage.setItem('reader:settings', JSON.stringify({ flow: f, pageTransition: false }))
    }, flow)
    await page.goto('/')
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'touch.epub',
      mimeType: 'application/epub+zip',
      buffer: await makeEpub(),
    })
    await page.getByRole('button', { name: /תיקייה מחבר מגע/ }).click({ timeout: 30_000 })
    await page.getByRole('button', { name: /ספר מגע/ }).click()
    await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })

    const position = page.getByLabel('מיקום בספר')
    const readFraction = async () => parseFloat(await position.inputValue())
    const { width, height } = page.viewportSize()!
    const tap = (x: number) => page.touchscreen.tap(x, height / 2)

    // the right edge goes back in a Hebrew book; at the very start of the book this used to lock
    // foliate's renderer in scrolled mode, after which nothing turned the page or jumped anywhere
    await tap(width * 0.9)
    await page.waitForTimeout(500)
    const start = await readFraction()

    // the left edge goes forward
    await tap(width * 0.1)
    await expect.poll(readFraction).toBeGreaterThan(start)

    await page.keyboard.press('t')
    await page.getByRole('button', { name: 'פרק 3' }).click()
    await expect(page.locator('.progress .label')).toContainText('פרק 3')
  })
}
