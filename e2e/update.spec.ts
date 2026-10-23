import { expect, test, type Page, type Route } from '@playwright/test'

const RELEASES = 'https://api.github.com/repos/ymalka82810/Reader/releases*'
const SHA = 'a'.repeat(64)

/** the Android shell injects window.Capacitor; here a stand-in records the native calls the update flow makes */
async function fakeNativeApp(page: Page, { versionCode, installError }: { versionCode: number; installError?: string }) {
  await page.addInitScript(
    ({ versionCode, installError }) => {
      const calls: { method: string; options?: unknown }[] = []
      ;(globalThis as unknown as { __nativeCalls: typeof calls }).__nativeCalls = calls
      const listeners: ((e: { percent: number }) => void)[] = []
      ;(globalThis as unknown as { Capacitor: object }).Capacitor = {
        isNativePlatform: () => true,
        isPluginAvailable: () => false,
        addListener: (_plugin: string, _event: string, cb: (e: { percent: number }) => void) => {
          listeners.push(cb)
          return { remove: () => {} }
        },
        nativePromise: async (plugin: string, method: string, options?: unknown) => {
          calls.push({ method, options })
          if (plugin === 'AppUpdater' && method === 'appInfo') return { versionCode, versionName: `1.0.${versionCode}` }
          if (plugin === 'AppUpdater' && method === 'downloadAndInstall') {
            listeners.forEach((l) => l({ percent: 40 }))
            if (installError) throw new Error(installError)
          }
          return {}
        },
      }
    },
    { versionCode, installError },
  )
}

const release = (code: number, extra: object = {}) => ({
  draft: false,
  prerelease: false,
  tag_name: `v1.0.${code}`,
  body: `versionCode: ${code}\nsha256: ${SHA}`,
  assets: [{ name: 'reader.apk', browser_download_url: `https://example.test/reader-${code}.apk` }],
  ...extra,
})

const serveReleases = (page: Page, releases: object[]) =>
  page.route(RELEASES, (route: Route) => route.fulfill({ json: releases }))

async function checkForUpdate(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'הגדרות', exact: true }).click()
  const screen = page.getByRole('dialog', { name: 'הגדרות', exact: true })
  await screen.getByRole('button', { name: 'אודות' }).click()
  await screen.getByRole('button', { name: 'בדוק עדכון' }).click()
}

const nativeCalls = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __nativeCalls: { method: string; options?: Record<string, unknown> }[] }).__nativeCalls)

test('a newer release asks first, then hands the APK and its checksum to the installer', async ({ page }) => {
  await fakeNativeApp(page, { versionCode: 10 })
  await serveReleases(page, [release(11), release(10)])
  await checkForUpdate(page)

  const dialog = page.getByRole('alertdialog', { name: 'יש גרסה חדשה' })
  await expect(dialog).toContainText('1.0.11')
  await dialog.getByRole('button', { name: 'עדכן' }).click()

  await expect.poll(async () => (await nativeCalls(page)).some((c) => c.method === 'downloadAndInstall')).toBe(true)
  const install = (await nativeCalls(page)).find((c) => c.method === 'downloadAndInstall')!
  expect(install.options).toEqual({ url: 'https://example.test/reader-11.apk', sha256: SHA })
})

test('declining the update installs nothing', async ({ page }) => {
  await fakeNativeApp(page, { versionCode: 10 })
  await serveReleases(page, [release(11)])
  await checkForUpdate(page)

  const dialog = page.getByRole('alertdialog', { name: 'יש גרסה חדשה' })
  await dialog.getByRole('button', { name: /ביטול|לא/ }).click()
  await expect(dialog).toHaveCount(0)
  expect((await nativeCalls(page)).some((c) => c.method === 'downloadAndInstall')).toBe(false)
})

test('the latest release equal to the installed version says the app is up to date', async ({ page }) => {
  await fakeNativeApp(page, { versionCode: 11 })
  await serveReleases(page, [release(11)])
  await checkForUpdate(page)
  await expect(page.getByText('האפליקציה מעודכנת')).toBeVisible()
  expect((await nativeCalls(page)).some((c) => c.method === 'downloadAndInstall')).toBe(false)
})

test('drafts, pre-releases and releases without an APK are never offered', async ({ page }) => {
  await fakeNativeApp(page, { versionCode: 10 })
  await serveReleases(page, [release(14, { draft: true }), release(13, { prerelease: true }), release(12, { assets: [] })])
  await checkForUpdate(page)
  await expect(page.getByText('האפליקציה מעודכנת')).toBeVisible()
})

test('a failed install shows the error and the app stays usable', async ({ page }) => {
  await fakeNativeApp(page, { versionCode: 10, installError: 'checksum' })
  await serveReleases(page, [release(11)])
  await checkForUpdate(page)
  await page.getByRole('alertdialog', { name: 'יש גרסה חדשה' }).getByRole('button', { name: 'עדכן' }).click()
  await expect(page.getByText('עדכון נכשל: checksum')).toBeVisible()
})

test('GitHub being unreachable shows an error instead of hanging', async ({ page }) => {
  await fakeNativeApp(page, { versionCode: 10 })
  await page.route(RELEASES, (route) => route.fulfill({ status: 500 }))
  await checkForUpdate(page)
  await expect(page.getByText(/עדכון נכשל/)).toBeVisible()
})
