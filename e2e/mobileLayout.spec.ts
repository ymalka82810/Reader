/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { makeEpub } from './epub.js'

/**
 * Phone-size layout guard: at 320px and 390px nothing may overflow sideways, fall off the screen
 * or be too small for a finger, and the library (with a folder, which the one-book a11y spec
 * never shows) and the reader (panel open) pass axe including colour contrast.
 */

const SIZES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
]

/** two books by one author, so the library shows a folder; a third by another author */
async function fillLibrary(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'a.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('ספר ראשון', 'מחברת א') },
    { name: 'b.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('ספר שני', 'מחברת א') },
    { name: 'c.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('ספר שלישי', 'מחבר ב') },
  ])
  await expect(page.locator('.folder').first()).toBeVisible({ timeout: 60_000 })
}

/** problems with the visible buttons and inputs on screen, as readable lines */
async function layoutProblems(page: Page, scope: string) {
  return page.evaluate((scope) => {
    const vw = document.documentElement.clientWidth
    const out: string[] = []
    if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls sideways')
    for (const el of document.querySelectorAll(`${scope} button, ${scope} input:not([type=file]):not([type=hidden])`)) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 20)
      const label = `${el.tagName.toLowerCase()} "${name}"`
      if (r.left < -1 || r.right > vw + 1) out.push(`${label} is off screen (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`)
      if (r.width < 43.5 || r.height < 43.5) out.push(`${label} is ${Math.round(r.width)}x${Math.round(r.height)}, under 44`)
    }
    return out
  }, scope)
}

for (const size of SIZES) {
  test.describe(`${size.width}px wide`, () => {
    test.use({ viewport: size, hasTouch: true })

    test('library: header on one line, nothing off screen, buttons finger-sized, axe clean', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await fillLibrary(page)
      const heading = page.getByRole('heading', { level: 1 })
      const box = await heading.boundingBox()
      const lineHeight = await heading.evaluate((h) => parseFloat(getComputedStyle(h).lineHeight) || h.getBoundingClientRect().height)
      expect(box!.height, 'the title stays on one line').toBeLessThan(lineHeight * 1.6)
      const add = page.locator('.lib-header .add-book')
      expect((await add.boundingBox())!.height, 'the add button stays on one line').toBeLessThan(60)
      await expect(add).toHaveAccessibleName(/הוסף ספר/)
      expect(await layoutProblems(page, '.lib-header, .lib-tools')).toEqual([])
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
    })

    test('reader: bars fit the screen, buttons finger-sized, settings panel axe clean', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/')
      await page.locator('input[type=file]').first().setInputFiles({ name: 'a.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('ספר לבדיקה', 'מחברת א') })
      await page.locator('.card').first().click({ timeout: 60_000 })
      await expect(page.getByText(/^עמוד/)).toBeVisible({ timeout: 30_000 })
      expect(await layoutProblems(page, '.topbar, .bottombar')).toEqual([])
      await page.getByRole('button', { name: 'הגדרות תצוגה' }).click()
      await expect(page.locator('.panel')).toBeVisible()
      expect(await layoutProblems(page, '.topbar, .bottombar')).toEqual([])
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
    })
  })
}
