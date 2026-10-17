import { expect, test } from '@playwright/test'

// a fake camera, so the on-device face model really loads and runs (it sees no face, which is fine here)
test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
})

test('eye scrolling loads the on-device face model and starts calibrating', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'eyes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('שלום עולם. '.repeat(500)),
  })
  await page.locator('.card', { hasText: 'eyes' }).click({ timeout: 30_000 })
  await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'הגדרות תצוגה' }).click()
  await page.getByLabel(/גלילה במבט/).check()
  await expect(page.getByRole('status').filter({ hasText: 'מכייל' })).toBeVisible({ timeout: 60_000 })
})
