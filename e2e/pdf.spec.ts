import { expect, test } from '@playwright/test'

// a PDF with a table is kept as the PDF itself and shown page by page
test('a PDF shown as is can be zoomed, and its text can be selected', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/test/fixtures/hebrew-table.pdf')
  await page.locator('.card').first().click({ timeout: 30_000 })


  const frame = () => page.frames().find((f) => f.url().startsWith('blob:'))
  const wordWidth = async () => (await frame()?.evaluate<number>(`document.querySelector('.textLayer span')?.getBoundingClientRect().width`)) ?? 0
  await expect.poll(wordWidth, { timeout: 30_000 }).toBeGreaterThan(0)
  const before = await wordWidth()

  await page.getByRole('button', { name: 'הגדרות' }).click()
  const zoom = page.getByRole('button', { name: 'התאמה לעמוד' })
  await expect(zoom).toHaveText('100%')
  await page.getByRole('button', { name: 'הגדלה' }).click()
  await expect(zoom).toHaveText('125%')
  await expect.poll(wordWidth).toBeGreaterThan(before * 1.2)

  await zoom.click()
  await expect(zoom).toHaveText('100%')
  await expect.poll(wordWidth).toBeCloseTo(before, 0)
  await page.keyboard.press('Escape')

  // drag across the first cell, from its right edge (the text is right to left)
  const box = await frame()!.evaluate<{ x: number; left: number; y: number }>(`(() => {
    const f = window.frameElement.getBoundingClientRect()
    const r = document.querySelector('.textLayer span').getBoundingClientRect()
    return { x: f.left + r.right - 1, left: f.left + r.left - 6, y: f.top + r.top + r.height / 2 }
  })()`)
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.left, box.y, { steps: 6 })
  await page.mouse.up()
  // the browser extends a drag that ends in the gap next to the cell up to the end of the page text, so the
  // exact extent differs between platforms; what matters is that the dragged-over word is selected
  await expect.poll(() => frame()!.evaluate<string>(`getSelection().toString()`)).toContain('שם')
})
